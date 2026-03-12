import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export enum PromotionType {
  FEE_WAIVER = 'FEE_WAIVER',
  FLAT_DISCOUNT = 'FLAT_DISCOUNT',
  PERCENTAGE_DISCOUNT = 'PERCENTAGE_DISCOUNT',
}

@Entity('promotions')
export class Promotion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({
    type: 'enum',
    enum: PromotionType,
    default: PromotionType.FLAT_DISCOUNT,
  })
  type: PromotionType;

  @Column({ type: 'int', default: 0 })
  value: number; // For flat discount (kobo) or percentage (0-100) or 0 for waiver

  @Column({ default: true })
  isActive: boolean;

  @Column({ type: 'jsonb', nullable: true })
  conditions: any; // { dayOfWeek: number, minAmount: number, maxUserTransactionCount: number, etc. }

  @Column({ type: 'int', default: 0 })
  priority: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
