import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';

@Entity('sos_escalation_events')
@Index(['sosId', 'level'], { unique: true })
export class SosEscalationEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'sos_id' })
  sosId: string;

  @Column({ type: 'int' })
  level: number;

  @Column({ type: 'timestamptz', name: 'due_at' })
  dueAt: Date;

  @Column({ type: 'timestamptz', name: 'fired_at', nullable: true })
  firedAt: Date | null;

  @Column({ type: 'varchar', length: 50 })
  channel: string;

  @Column({ type: 'uuid', name: 'recipient_id', nullable: true })
  recipientId: string | null;

  @Column({
    type: 'varchar',
    length: 200,
    name: 'provider_message_id',
    nullable: true,
  })
  providerMessageId: string | null;

  @Column({ type: 'varchar', length: 50 })
  outcome: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata: any;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @ManyToOne('SOSRequest', { createForeignKeyConstraints: false })
  @JoinColumn({ name: 'sos_id' })
  sosRequest: any;
}
