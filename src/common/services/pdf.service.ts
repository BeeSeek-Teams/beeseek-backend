import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import puppeteer, { Browser, Page } from 'puppeteer-core';

/**
 * High-performance PDF generation service using Puppeteer with browser pooling.
 * 
 * Optimizations:
 * - Single browser instance reused across requests (no spin-up time)
 * - Page pool to handle concurrent requests
 * - Pre-configured for A4 output with consistent rendering
 * - Auto-reconnect on browser disconnection
 */
@Injectable()
export class PdfService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PdfService.name);
  private browser: Browser | null = null;
  private pagePool: Page[] = [];
  private readonly POOL_SIZE = 3; // Number of pre-warmed pages
  private isInitializing = false;
  private initPromise: Promise<void> | null = null;

  async onModuleInit() {
    try {
      await this.initBrowser();
    } catch (error) {
      this.logger.warn(
        'Puppeteer browser not available — PDF generation disabled until Chrome/Chromium is installed. ' +
        error?.message,
      );
    }
  }

  async onModuleDestroy() {
    await this.closeBrowser();
  }

  private async initBrowser(): Promise<void> {
    if (this.browser && this.browser.connected) return;
    if (this.isInitializing && this.initPromise) {
      return this.initPromise;
    }

    this.isInitializing = true;
    this.initPromise = (async () => {
      try {
        // Clean up any stale browser/pages
        await this.closeBrowser();

        // Find Chrome executable path based on OS
        const executablePath = this.getChromePath();
        
        this.browser = await puppeteer.launch({
          executablePath,
          headless: true,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu',
            '--no-first-run',
            '--no-zygote',
            '--disable-extensions',
            '--disable-crashpad',
            '--disable-breakpad',
            '--disable-component-extensions-with-background-pages',
            '--disable-component-update',
            '--disable-plugins',
            '--disable-plugin-power-saver',
            '--single-process',
          ],
          // Suppress all crash/breakpad functionality in containerised environments
          env: {
            ...process.env,
            CHROME_CRASHPAD_PIPE_NAME: '',
            CHROME_HEADLESS: '1',
            BREAKPAD_DUMP_LOCATION: '/tmp',
          },
        });

        // Listen for browser disconnection
        this.browser.on('disconnected', () => {
          this.logger.warn('Browser disconnected, will reinitialize on next request');
          this.browser = null;
          this.pagePool = [];
          this.initPromise = null;
        });

        this.logger.log('Browser instance initialized');

        // Pre-warm page pool
        for (let i = 0; i < this.POOL_SIZE; i++) {
          const page = await this.browser.newPage();
          await page.setViewport({ width: 794, height: 1123 }); // A4 at 96 DPI
          this.pagePool.push(page);
        }

        this.logger.log(`Page pool initialized with ${this.POOL_SIZE} pages`);
      } catch (error) {
        this.logger.error('Failed to initialize browser', error);
        this.browser = null;
        this.pagePool = [];
        throw error;
      } finally {
        this.isInitializing = false;
      }
    })();

    return this.initPromise;
  }

  private getChromePath(): string {
    // Check for Docker/Linux environment variable first
    if (process.env.PUPPETEER_EXECUTABLE_PATH) {
      return process.env.PUPPETEER_EXECUTABLE_PATH;
    }

    // Platform-specific paths
    switch (process.platform) {
      case 'darwin':
        return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
      case 'linux':
        return '/usr/bin/google-chrome';
      case 'win32':
        return 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
      default:
        throw new Error(`Unsupported platform: ${process.platform}`);
    }
  }

  private async getPage(): Promise<Page> {
    // Ensure browser is connected
    if (!this.browser || !this.browser.connected) {
      this.initPromise = null; // Force re-init
      await this.initBrowser();
    }

    // Get a page from pool or create new one
    let page = this.pagePool.pop();
    
    // Validate the page is still usable
    if (page) {
      try {
        // Quick check if page is still valid
        await page.evaluate(() => true);
      } catch {
        this.logger.warn('Stale page detected, creating new one');
        page = undefined;
      }
    }

    if (!page && this.browser) {
      page = await this.browser.newPage();
      await page.setViewport({ width: 794, height: 1123 });
    }

    if (!page) {
      throw new Error('Failed to acquire page from pool');
    }

    return page;
  }

  private async releasePage(page: Page): Promise<void> {
    try {
      // Check if page is still valid before reusing
      if (page.isClosed()) {
        return;
      }
      
      // Clear page content before returning to pool
      await page.goto('about:blank');
      
      if (this.pagePool.length < this.POOL_SIZE) {
        this.pagePool.push(page);
      } else {
        await page.close();
      }
    } catch (error) {
      this.logger.warn('Failed to release page, discarding it');
      try {
        if (!page.isClosed()) {
          await page.close();
        }
      } catch {
        // Ignore close errors
      }
    }
  }

  private async closeBrowser(): Promise<void> {
    // Close all pooled pages
    for (const page of this.pagePool) {
      try {
        if (!page.isClosed()) {
          await page.close();
        }
      } catch {
        // Ignore
      }
    }
    this.pagePool = [];

    if (this.browser) {
      try {
        await this.browser.close();
      } catch {
        // Ignore close errors
      }
      this.browser = null;
      this.logger.log('Browser instance closed');
    }
  }

  /**
   * Generate a PDF from HTML content.
   * Returns a Buffer containing the PDF data.
   * Includes retry logic for browser connection issues.
   */
  async generatePdf(html: string, retries = 2): Promise<Buffer> {
    for (let attempt = 0; attempt <= retries; attempt++) {
      let page: Page | null = null;
      try {
        page = await this.getPage();
        
        // Set content with optimized wait strategy
        await page.setContent(html, {
          waitUntil: 'domcontentloaded', // Faster than 'networkidle0'
        });

        // Generate PDF
        const pdfBuffer = await page.pdf({
          format: 'A4',
          printBackground: true,
          margin: {
            top: '20mm',
            right: '20mm',
            bottom: '20mm',
            left: '20mm',
          },
          preferCSSPageSize: true,
        });

        return Buffer.from(pdfBuffer);
      } catch (error) {
        this.logger.warn(`PDF generation attempt ${attempt + 1} failed`, error);
        
        // Force browser reinit on connection errors
        if ((error as Error).message?.includes('Connection closed') || 
            (error as Error).message?.includes('Target closed')) {
          this.browser = null;
          this.pagePool = [];
          this.initPromise = null;
        }
        
        if (attempt === retries) {
          throw error;
        }
        // Wait before retry
        await new Promise(r => setTimeout(r, 500));
      } finally {
        if (page) {
          await this.releasePage(page);
        }
      }
    }
    throw new Error('PDF generation failed after retries');
  }

  /**
   * Generate Service Agreement PDF for a contract.
   */
  async generateServiceAgreementPdf(contract: {
    id: string;
    details: string;
    workmanshipCost: number;
    transportFare: number;
    materials?: { item: string; cost: number }[];
    commissionAmount: number;
    serviceFee: number;
    agent?: { firstName: string; lastName: string };
    client?: { firstName: string; lastName: string };
  }): Promise<Buffer> {
    // Financial calculations (values are in Kobo, convert to Naira)
    const workmanshipNaira = (contract.workmanshipCost || 0) / 100;
    const transportNaira = (contract.transportFare || 0) / 100;
    const materialsTotalNaira = (contract.materials || []).reduce(
      (acc, m) => acc + (m.cost || 0) / 100,
      0,
    );
    const baseGrossNaira = workmanshipNaira + transportNaira + materialsTotalNaira;
    const commissionNaira = (contract.commissionAmount || 0) / 100;
    const serviceFeeNaira = (contract.serviceFee || 0) / 100;
    const netEarningsNaira = baseGrossNaira - commissionNaira;
    const totalClientCostNaira = baseGrossNaira + serviceFeeNaira;

    const executionDate = new Date().toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    });

    const formatCurrency = (amount: number) =>
      `NGN ${amount.toLocaleString('en-NG', { minimumFractionDigits: 0 })}`;

    const html = `
<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8">
    <style>
      @page {
        size: A4;
        margin: 0;
      }
      * {
        box-sizing: border-box;
        margin: 0;
        padding: 0;
      }
      body {
        font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
        color: #031745;
        line-height: 1.6;
        font-size: 10pt;
        background-color: white;
        padding: 20mm;
      }
      .watermark {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%) rotate(-45deg);
        font-size: 60pt;
        color: rgba(3, 23, 69, 0.04);
        font-weight: 800;
        white-space: nowrap;
        z-index: -1;
        text-transform: uppercase;
        pointer-events: none;
      }
      .header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        border-bottom: 2pt solid #031745;
        padding-bottom: 15pt;
        margin-bottom: 20pt;
      }
      .header-left h1 {
        font-size: 24pt;
        font-weight: 800;
        color: #031745;
        margin: 0;
      }
      .header-left .ref {
        font-size: 8pt;
        color: #6B7280;
        margin-top: 4pt;
      }
      .header-right {
        text-align: right;
      }
      .header-right .brand {
        font-size: 16pt;
        font-weight: 800;
        color: #031745;
      }
      .header-right .tagline {
        font-size: 7pt;
        color: #6B7280;
      }
      .section {
        margin-bottom: 18pt;
        page-break-inside: avoid;
      }
      .section-title {
        font-size: 9pt;
        font-weight: 800;
        text-transform: uppercase;
        letter-spacing: 1px;
        color: #031745;
        margin-bottom: 8pt;
        border-bottom: 0.5pt solid #E5E7EB;
        padding-bottom: 4pt;
      }
      .content-box {
        background-color: #F9FAFB;
        border-radius: 6pt;
        padding: 12pt;
      }
      .party-row {
        display: flex;
        justify-content: space-between;
        margin-bottom: 6pt;
      }
      .party-row:last-child { margin-bottom: 0; }
      .label {
        font-size: 8pt;
        color: #6B7280;
      }
      .value {
        font-size: 9pt;
        font-weight: 600;
        color: #031745;
      }
      .scope-text {
        font-size: 9pt;
        color: #4B5563;
        line-height: 1.7;
        white-space: pre-wrap;
      }
      .finance-table {
        width: 100%;
        border-collapse: collapse;
      }
      .finance-table tr {
        border-bottom: 0.5pt solid #F3F4F6;
      }
      .finance-table td {
        padding: 6pt 0;
        font-size: 9pt;
      }
      .finance-table td:first-child {
        color: #4B5563;
      }
      .finance-table td:last-child {
        text-align: right;
        font-weight: 600;
        color: #031745;
      }
      .finance-table .material-row td {
        font-size: 8pt;
        color: #6B7280;
        padding: 3pt 0 3pt 12pt;
      }
      .finance-table .total-row {
        border-top: 1.5pt solid #031745;
        border-bottom: none;
      }
      .finance-table .total-row td {
        font-weight: 800;
        font-size: 10pt;
        padding-top: 10pt;
      }
      .finance-table .payout-row td {
        color: #00C164;
        font-size: 11pt;
        font-weight: 800;
      }
      .finance-table .fee-row td {
        font-size: 8pt;
        color: #9CA3AF;
      }
      .finance-table .deduction-row td:last-child {
        color: #EF4444;
      }
      .terms-list {
        font-size: 8pt;
        color: #6B7280;
        line-height: 1.8;
        padding-left: 12pt;
      }
      .terms-list li {
        margin-bottom: 4pt;
      }
      .terms-list strong {
        color: #031745;
      }
      .footer {
        position: fixed;
        bottom: 15mm;
        left: 20mm;
        right: 20mm;
        text-align: center;
        font-size: 7pt;
        color: #9CA3AF;
        border-top: 0.5pt solid #F3F4F6;
        padding-top: 8pt;
      }
      .footer-id {
        font-family: 'Courier New', monospace;
        font-size: 6pt;
        color: #D1D5DB;
        margin-top: 4pt;
      }
    </style>
  </head>
  <body>
    <div class="watermark">Verified By BeeSeek</div>
    
    <div class="header">
      <div class="header-left">
        <h1>Service Agreement</h1>
        <div class="ref">REF: BS-${contract.id.slice(0, 8).toUpperCase()} | Executed: ${executionDate}</div>
      </div>
      <div class="header-right">
        <div class="brand">BeeSeek</div>
        <div class="tagline">Verified Service Platform</div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">1. Contracting Parties</div>
      <div class="content-box">
        <div class="party-row">
          <span class="label">Service Provider (Agent)</span>
          <span class="value">${contract.agent?.firstName || 'System'} ${contract.agent?.lastName || 'User'}</span>
        </div>
        <div class="party-row">
          <span class="label">Contracting Client</span>
          <span class="value">${contract.client?.firstName || 'System'} ${contract.client?.lastName || 'User'}</span>
        </div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">2. Scope of Service</div>
      <div class="scope-text">${contract.details || 'No details provided.'}</div>
    </div>

    <div class="section">
      <div class="section-title">3. Financial Schedule</div>
      <table class="finance-table">
        <tr>
          <td>Workmanship</td>
          <td>${formatCurrency(workmanshipNaira)}</td>
        </tr>
        <tr>
          <td>Logistics & Transport</td>
          <td>${formatCurrency(transportNaira)}</td>
        </tr>
        ${(contract.materials || []).map(m => `
        <tr class="material-row">
          <td>• ${m.item}</td>
          <td>${formatCurrency(m.cost / 100)}</td>
        </tr>
        `).join('')}
        <tr class="total-row">
          <td>Gross Contract Value</td>
          <td>${formatCurrency(baseGrossNaira)}</td>
        </tr>
        <tr class="fee-row">
          <td>Platform Service Fee (Client)</td>
          <td>+ ${formatCurrency(serviceFeeNaira)}</td>
        </tr>
        <tr>
          <td><strong>Total Payment (Client Outlay)</strong></td>
          <td><strong>${formatCurrency(totalClientCostNaira)}</strong></td>
        </tr>
        <tr class="fee-row deduction-row">
          <td>Platform Commission (Agent)</td>
          <td>- ${formatCurrency(commissionNaira)}</td>
        </tr>
        <tr class="total-row payout-row">
          <td>Net Agent Payout</td>
          <td>${formatCurrency(netEarningsNaira)}</td>
        </tr>
      </table>
    </div>

    <div class="section">
      <div class="section-title">4. Binding Terms</div>
      <ul class="terms-list">
        <li>Funds are held securely by BeeSeek as the neutral <strong>Escrow Agent</strong>.</li>
        <li>Service Provider shall mark the job as <strong>'Completed'</strong> upon physical delivery.</li>
        <li>Client has <strong>48 hours</strong> to inspect and release funds after completion.</li>
        <li>This document is a legally binding record and forensic evidence of the agreement.</li>
      </ul>
    </div>

    <div class="section">
      <div class="section-title">5. Platform Protections</div>
      <ul class="terms-list">
        <li><strong>Arbitration:</strong> Parties agree that BeeSeek is the final arbitrator for Escrow fund disputes based on platform evidence.</li>
        <li><strong>Liability:</strong> BeeSeek is a venue provider and is not liable for party conduct, damages, or quality of service.</li>
        <li><strong>Governing Law:</strong> This agreement is governed by the laws of the Federal Republic of Nigeria.</li>
      </ul>
    </div>

    <div class="footer">
      This is a digitally certified copy of the service agreement between the parties listed above.<br/>
      © ${new Date().getFullYear()} BeeSeek Technologies Inc.
      <div class="footer-id">FORENSIC-ID: ${contract.id.toUpperCase()}</div>
    </div>
  </body>
</html>
    `;

    return this.generatePdf(html);
  }
}
