import { Request, Response } from 'express';

/** No deletion or historical rewrite without an audited correction workflow. */
export function preserveRecords(_req: Request, res: Response): void {
  res.status(409).json({
    error: 'Existing records are preserved. Use retirement where supported; historical corrections require an approved, auditable reconciliation.',
  });
}
