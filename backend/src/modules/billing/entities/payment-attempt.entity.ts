import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('payment_attempts')
export class PaymentAttempt {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 200, unique: true })
  reference: string;

  @Column({ type: 'uuid', name: 'community_id' })
  communityId: string;

  @Column({ type: 'varchar', length: 50 })
  plan: string;

  @Column({ type: 'integer' })
  amount: number;

  @Column({ type: 'varchar', length: 10 })
  currency: string;

  @Column({ type: 'varchar', length: 20, default: 'pending' })
  status: string;

  @Column({ type: 'text', name: 'authorization_url', nullable: true })
  authorizationUrl: string | null;

  @Column({ type: 'uuid', name: 'subscription_id', nullable: true })
  subscriptionId: string | null;

  @Column({ type: 'jsonb', name: 'provider_response', nullable: true })
  providerResponse: any;

  @Column({ type: 'timestamptz', name: 'completed_at', nullable: true })
  completedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
