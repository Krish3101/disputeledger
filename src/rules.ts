export type UserRole = 'partner' | 'arbiter';
export type DisputeStatus = 'OPEN' | 'RESOLVED';

type User = { id: string; role: UserRole };
type Parties = { claimantId: string; respondentId: string };

// The one error type. The error handler sends its status, code and message as JSON.
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
  }
}

function isParty(user: User, dispute: Parties): boolean {
  return dispute.claimantId === user.id || dispute.respondentId === user.id;
}

export function canView(user: User, dispute: Parties): boolean {
  return user.role === 'arbiter' || isParty(user, dispute);
}

export function canAddEvidence(user: User, dispute: Parties): boolean {
  return user.role === 'partner' && isParty(user, dispute);
}

export function canResolve(user: User): boolean {
  return user.role === 'arbiter';
}
