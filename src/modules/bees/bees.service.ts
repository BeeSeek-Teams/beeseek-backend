import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Bee } from '../../entities/bee.entity';
import { CreateBeeDto } from './dto/create-bee.dto';
import { User, UserStatus } from '../../entities/user.entity';

@Injectable()
export class BeesService {
  private readonly logger = new Logger(BeesService.name);

  constructor(
    @InjectRepository(Bee)
    private beesRepository: Repository<Bee>,
    private dataSource: DataSource,
  ) {}

  /** Build a GeoJSON Point that PostGIS geography columns understand */
  private toGeoPoint(lng: number, lat: number): object {
    return { type: 'Point', coordinates: [lng, lat] };
  }

  async create(createBeeDto: CreateBeeDto, agent: User): Promise<Bee> {
    const bee = this.beesRepository.create({
      ...createBeeDto,
      agentId: agent.id,
      location: this.toGeoPoint(createBeeDto.longitude, createBeeDto.latitude) as any,
    });
    return this.beesRepository.save(bee);
  }

  async findAllByAgent(agentId: string): Promise<Bee[]> {
    return this.beesRepository.find({
      where: { 
        agentId,
        agent: {
          status: UserStatus.ACTIVE,
          isDeleted: false
        }
      },
      relations: ['agent'],
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: string): Promise<Bee> {
    const bee = await this.beesRepository.findOne({
      where: { id },
      relations: ['agent'],
    });
    if (!bee) {
      throw new NotFoundException(`Bee with ID ${id} not found`);
    }
    return bee;
  }

  async update(
    id: string,
    updateBeeDto: Partial<CreateBeeDto>,
    agentId: string,
  ): Promise<Bee> {
    const bee = await this.findOne(id);
    if (bee.agentId !== agentId) {
      throw new NotFoundException(
        'You do not have permission to update this Bee',
      );
    }
    
    Object.assign(bee, updateBeeDto);
    
    // Update spatial location if coordinates changed
    if (updateBeeDto.latitude !== undefined || updateBeeDto.longitude !== undefined) {
      bee.location = this.toGeoPoint(bee.longitude, bee.latitude) as any;
    }
    
    return this.beesRepository.save(bee);
  }

  async remove(id: string, agentId: string): Promise<void> {
    const bee = await this.findOne(id);
    if (bee.agentId !== agentId) {
      throw new NotFoundException(
        'You do not have permission to delete this Bee',
      );
    }
    await this.beesRepository.remove(bee);
  }

  async migrateLocations(agentId: string, lat: number, lng: number, address: string): Promise<void> {
    const bees = await this.beesRepository.find({ where: { agentId } });
    if (bees.length === 0) return;

    for (const bee of bees) {
      bee.latitude = lat;
      bee.longitude = lng;
      bee.locationAddress = address;
      bee.location = this.toGeoPoint(lng, lat) as any;
    }

    await this.beesRepository.save(bees);
  }

  async adminRemove(id: string): Promise<void> {
    const bee = await this.findOne(id);
    await this.beesRepository.remove(bee);
  }

  async adminToggleActive(id: string): Promise<Bee> {
    const bee = await this.findOne(id);
    bee.isActive = !bee.isActive;
    return this.beesRepository.save(bee);
  }

  async adminFindAll(query: {
    search?: string;
    category?: string;
    isActive?: string;
    take?: number;
    skip?: number;
    sortBy?: string;
    sortOrder?: 'ASC' | 'DESC';
  }): Promise<{ items: Bee[]; total: number }> {
    const qb = this.beesRepository.createQueryBuilder('bee')
      .leftJoinAndSelect('bee.agent', 'agent')
      .orderBy('bee.createdAt', 'DESC');

    if (query.search) {
      qb.andWhere(
        '(bee.title ILIKE :search OR bee.category ILIKE :search OR bee.description ILIKE :search OR agent.firstName ILIKE :search OR agent.lastName ILIKE :search)',
        { search: `%${query.search}%` }
      );
    }

    if (query.category) {
      qb.andWhere('bee.category = :category', { category: query.category });
    }

    if (query.isActive !== undefined && query.isActive !== '') {
      qb.andWhere('bee.isActive = :isActive', { isActive: query.isActive === 'true' });
    }

    if (query.sortBy) {
      const order = query.sortOrder || 'DESC';
      if (query.sortBy === 'price') qb.orderBy('bee.price', order);
      else if (query.sortBy === 'rating') qb.orderBy('bee.rating', order);
      else if (query.sortBy === 'totalHires') qb.orderBy('bee.totalHires', order);
      else if (query.sortBy === 'totalRevenue') qb.orderBy('bee.totalRevenue', order);
      else if (query.sortBy === 'createdAt') qb.orderBy('bee.createdAt', order);
    }

    const [items, total] = await qb
      .take(query.take || 20)
      .skip(query.skip || 0)
      .getManyAndCount();

    return { items, total };
  }

  async getAdminStats(): Promise<{
    totalBees: number;
    activeBees: number;
    inactiveBees: number;
    totalRevenue: number;
    avgRating: number;
    categories: { category: string; count: number }[];
  }> {
    const totalBees = await this.beesRepository.count();
    const activeBees = await this.beesRepository.count({ where: { isActive: true } });
    const inactiveBees = totalBees - activeBees;

    const stats = await this.beesRepository
      .createQueryBuilder('bee')
      .select('SUM(bee.totalRevenue)', 'totalRevenue')
      .addSelect('AVG(bee.rating)', 'avgRating')
      .getRawOne();

    const categories = await this.beesRepository
      .createQueryBuilder('bee')
      .select('bee.category', 'category')
      .addSelect('COUNT(*)', 'count')
      .groupBy('bee.category')
      .orderBy('count', 'DESC')
      .getRawMany();

    return {
      totalBees,
      activeBees,
      inactiveBees,
      totalRevenue: Number(stats?.totalRevenue || 0),
      avgRating: Number(Number(stats?.avgRating || 0).toFixed(2)),
      categories: categories.map(c => ({ category: c.category, count: Number(c.count) })),
    };
  }

  async searchNearby(
    lat: number,
    lng: number,
    category?: string,
    radiusKm: number = 15,
    page: number = 1,
    limit: number = 20,
    search?: string,
    minRating?: number,
    verifiedOnly?: boolean,
    onlineOnly?: boolean,
    hasInspection?: boolean,
    sortBy?: string,
  ): Promise<{ data: Bee[]; total: number; page: number; lastPage: number }> {
    const query = this.beesRepository
      .createQueryBuilder('bee')
      .leftJoinAndSelect('bee.agent', 'agent')
      // High Performance Spatial Indexing - Find all within radius using GIST index
      .andWhere(
        'ST_DWithin(bee.location, ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography, :radiusMeters)',
        { 
            lng, 
            lat, 
            radiusMeters: radiusKm * 1000 
        }
      )
      // Drift Filter: Hide Bees if the Agent's real-time location is > 50km from the Bee's pinned location
      // This prevents "stale" Bees from appearing if an agent moves to another city
      .andWhere(
        '(agent.latitude IS NULL OR agent.longitude IS NULL OR ST_DWithin(bee.location, ST_SetSRID(ST_MakePoint(agent.longitude, agent.latitude), 4326)::geography, 50000))'
      )
      .andWhere('bee.isActive = :isActive', { isActive: true })
      .andWhere('agent.status = :status', { status: UserStatus.ACTIVE })
      .andWhere('agent.isDeleted = :isDeleted', { isDeleted: false });

    // Status Filter - If searching for all, we still respect isActive. 
    // If onlineOnly is true, we filter by agent availability.
    if (onlineOnly) {
        query.andWhere('agent.isAvailable = :isAvailable', { isAvailable: true });
    }

    // Verified Filter
    if (verifiedOnly) {
        query.andWhere('agent.nin_verified_at IS NOT NULL');
    }

    // Inspection Filter
    if (hasInspection) {
        query.andWhere('bee.offersInspection = :hasInspection', { hasInspection: true });
    }

    // Rating Filter
    if (minRating) {
        query.andWhere('bee.rating >= :minRating', { minRating });
    }

    // Distance Calculation (Scientific accuracy via PostGIS Geography)
    const distanceSql = 'ST_Distance(bee.location, ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography)';
    query.addSelect(distanceSql, 'distance_meters');

    // Relevance/Trust Scoring Logic
    // Ranks 'Verified', 'Highly Rated', and 'Nearby' agents higher than just 'Closest'
    const relevanceScoreSql = `(
        (bee.rating * 1.5) + 
        (CASE WHEN agent.nin_verified_at IS NOT NULL THEN 2.0 ELSE 0 END) +
        (CASE 
            WHEN ${distanceSql} < 2000 THEN 3.0 -- Premium proximity bonus (<2km)
            WHEN ${distanceSql} < 5000 THEN 2.0
            WHEN ${distanceSql} < 10000 THEN 1.0
            ELSE 0 
         END) +
        (LEAST(bee.jobsCompleted / 30.0, 1.0)) -- Experience bonus (capped at 1pt)
    )`;
    query.addSelect(relevanceScoreSql, 'relevance_score');
    query.setParameter('searchQuery', search || null);

    // Smart Filtering with Case-Insensitive Text Search
    if (search) {
      // ILIKE: Standard substring matching (case-insensitive)
      query.andWhere(
        `(
          bee.title ILIKE :search OR 
          bee.description ILIKE :search OR 
          bee.category ILIKE :search OR 
          bee.clientRequirements ILIKE :search
        )`,
        { 
            search: `%${search}%`
        }
      );
    }
    
    if (category && category !== 'All') {
      query.andWhere('bee.category = :category', { category });
    }

    // Sort Logic
    if (sortBy === 'rating') {
        query.orderBy('bee.rating', 'DESC');
    } else if (sortBy === 'inspection_price') {
        query.orderBy('bee.inspectionPrice', 'ASC');
    } else if (sortBy === 'distance') {
        query.orderBy('distance_meters', 'ASC');
    } else {
        // Default: Sort by Multi-Factor Relevance, then by Distance for ties
        query.orderBy('relevance_score', 'DESC');
        query.addOrderBy('distance_meters', 'ASC');
    }

    this.logger.debug(
      `[Power-Search] Center: ${lat}, ${lng} | Query: "${search}" | Category: "${category}" | Sort: ${sortBy}`,
    );

    const total = await query.getCount();
    
    // Execute search with pagination
    const rawResults = await query
      .offset((page - 1) * limit)
      .limit(limit)
      .getRawAndEntities();

    // Map distances back to entities for UI display
    const data = rawResults.entities.map((entity, index) => {
        const raw = rawResults.raw[index];
        return {
            ...entity,
            distance: Number((raw.distance_meters / 1000).toFixed(2)), // Return as km
            relevanceScore: Number(raw.relevance_score),
        };
    });

    return {
      data: data as any,
      total,
      page,
      lastPage: Math.ceil(total / limit),
    };
  }

  /**
   * Reconcile bee metrics from actual contract data.
   * Recalculates totalHires, jobsCompleted, and totalRevenue from source of truth.
   */
  async reconcileMetrics(): Promise<{ updated: number }> {
    this.logger.log('Starting bee metrics reconciliation...');

    // 1. Reconcile totalHires (contracts that were paid = actual hires)
    await this.dataSource.query(`
      UPDATE "bees" b
      SET "totalHires" = COALESCE(sub.hire_count, 0)
      FROM (
        SELECT "beeId", COUNT(*) AS hire_count
        FROM "contracts"
        WHERE "status" IN ('PAID', 'IN_PROGRESS', 'COMPLETED')
        GROUP BY "beeId"
      ) sub
      WHERE b.id = sub."beeId"
    `);

    // 2. Reconcile jobsCompleted
    await this.dataSource.query(`
      UPDATE "bees" b
      SET "jobsCompleted" = COALESCE(sub.completed_count, 0)
      FROM (
        SELECT "beeId", COUNT(*) AS completed_count
        FROM "contracts"
        WHERE "status" = 'COMPLETED'
        GROUP BY "beeId"
      ) sub
      WHERE b.id = sub."beeId"
    `);

    // 3. Reconcile totalRevenue (workmanshipCost - commissionAmount for completed contracts, converted from kobo to naira)
    await this.dataSource.query(`
      UPDATE "bees" b
      SET "totalRevenue" = COALESCE(sub.total_revenue, 0) / 100
      FROM (
        SELECT "beeId", SUM("workmanshipCost" - "commissionAmount") AS total_revenue
        FROM "contracts"
        WHERE "status" = 'COMPLETED'
        GROUP BY "beeId"
      ) sub
      WHERE b.id = sub."beeId"
    `);

    const updated = await this.beesRepository.count();
    this.logger.log(`Bee metrics reconciliation complete. ${updated} bees in system.`);
    return { updated };
  }
}
