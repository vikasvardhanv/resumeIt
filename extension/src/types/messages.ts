export enum MessageType {
  JobExtracted = 'JOB_EXTRACTED',
  TailorRequest = 'TAILOR_REQUEST',
  TailorResult = 'TAILOR_RESULT',
  GetJob = 'GET_JOB'
}

export interface JobData {
  title: string;
  company?: string;
  location?: string;
  description: string;
  requirements?: string[];
  hash: string; // SHA256 or simple hash of normalized job
  source: string; // domain
  pageUrl?: string;
}

export interface JobExtractionMessage {
  type: MessageType.JobExtracted;
  job: JobData;
}

export interface TailorRequestMessage {
  type: MessageType.TailorRequest;
  job: JobData;
  resumeId?: string;
}

export interface TailorResultMessage {
  type: MessageType.TailorResult;
  jobHash: string;
  result: any; // Will refine with schema later
}
