import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

// ─── Screening result types ──────────────────────────────────────────────────

export interface ScreeningMatch {
  name: string;
  matchScore: number;
  /** PEP | SANCTIONS | CRIMINAL | WATCHLIST | ADVERSE_MEDIA | OTHER */
  category: string;
  source: string;
  details?: string;
}

export interface BackgroundScreeningResult {
  success: boolean;
  /** Overall risk assessment */
  riskLevel?: 'low' | 'medium' | 'high' | 'unknown';
  /** Politically Exposed Person flag */
  isPEP?: boolean;
  /** Appears on sanctions lists */
  isSanctioned?: boolean;
  /** Appears on any criminal or watchlist database */
  isWatchlisted?: boolean;
  /** Total watchlist / criminal matches found */
  totalMatches?: number;
  /** Individual screening matches */
  matches?: ScreeningMatch[];
  /** Youverify report / screening ID for reference */
  reportId?: string;
  /** Raw API response for audit trail */
  rawResponse?: any;
  error?: string;
}

// ─── Service ─────────────────────────────────────────────────────────────────

@Injectable()
export class BackgroundCheckService {
  private readonly logger = new Logger(BackgroundCheckService.name);

  private get apiKey(): string {
    return process.env.YOUVERIFY_API_KEY || '';
  }

  private get isSandbox(): boolean {
    return process.env.YOUVERIFY_SANDBOX_MODE === 'true';
  }

  private get baseUrl(): string {
    return this.isSandbox
      ? 'https://sandbox.youverify.co'
      : 'https://api.youverify.co';
  }

  /**
   * Screen an individual against global AML / PEP / Sanctions / Criminal
   * watchlists via the Youverify Screening API.
   *
   * Endpoint: POST /v2/api/screenings
   * Auth:     { token: <apiKey> }
   *
   * @see https://doc.youverify.co  (AML Screening → Individual)
   */
  async screenIndividual(
    firstName: string,
    lastName: string,
    dateOfBirth?: string,
    country: string = 'NG',
  ): Promise<BackgroundScreeningResult> {
    if (!this.apiKey) {
      this.logger.warn('Youverify API key not configured — skipping background check');
      return { success: false, error: 'Background check service not configured' };
    }

    try {
      const fullName = `${firstName} ${lastName}`;
      this.logger.log(`[BackgroundCheck] Screening individual: ${fullName}`);

      const body: Record<string, any> = {
        firstName,
        lastName,
        country,
        type: 'individual',
      };
      if (dateOfBirth) body.dateOfBirth = dateOfBirth;

      const { data } = await axios.post(
        `${this.baseUrl}/v2/api/screenings`,
        body,
        {
          headers: {
            token: this.apiKey,
            'Content-Type': 'application/json',
          },
          timeout: 30_000,
        },
      );

      this.logger.log(
        `[BackgroundCheck] Youverify response: ${data?.statusCode} — ${data?.message}`,
      );

      if (data?.success || data?.statusCode === 200) {
        const result = data?.data || data;

        const matches: ScreeningMatch[] = (result?.matches || result?.results || []).map(
          (m: any) => ({
            name: m?.name || m?.entityName || m?.fullName || 'Unknown',
            matchScore: m?.matchScore ?? m?.score ?? 0,
            category: (
              m?.category || m?.type || m?.listType || 'OTHER'
            ).toUpperCase(),
            source: m?.source || m?.listName || m?.database || 'Unknown',
            details: m?.details || m?.description || m?.reason,
          }),
        );

        const hasPEP =
          result?.isPEP ?? matches.some((m) => m.category === 'PEP');
        const hasSanctions =
          result?.isSanctioned ??
          matches.some((m) => m.category === 'SANCTIONS');
        const hasWatchlist =
          result?.isWatchlisted ??
          matches.some(
            (m) =>
              m.category === 'WATCHLIST' ||
              m.category === 'CRIMINAL' ||
              m.category === 'ADVERSE_MEDIA',
          );

        const riskLevel: BackgroundScreeningResult['riskLevel'] =
          result?.riskLevel ??
          (hasSanctions || hasPEP
            ? 'high'
            : matches.length > 0
              ? 'medium'
              : 'low');

        return {
          success: true,
          riskLevel,
          isPEP: hasPEP,
          isSanctioned: hasSanctions,
          isWatchlisted: hasWatchlist,
          totalMatches: result?.totalMatches ?? matches.length,
          matches,
          reportId: result?.id || result?.reportId,
          rawResponse: data,
        };
      }

      return {
        success: false,
        error: data?.message || 'Screening request failed',
        rawResponse: data,
      };
    } catch (error: any) {
      const errorData = error?.response?.data;
      const status = error?.response?.status;
      this.logger.error(
        `[BackgroundCheck] Youverify API error: HTTP ${status} — ${JSON.stringify(errorData || error.message)}`,
      );

      return {
        success: false,
        error:
          errorData?.message ||
          error.message ||
          'Background check API unavailable',
        rawResponse: errorData,
      };
    }
  }
}
