export type KycStatus = 'approved' | 'rejected' | 'manual_review';

export interface Application {
  id: string;
  customer_id: string;
  status: KycStatus;
  document_url: string;
  provider_reference: string;
  created_at: string;
}
