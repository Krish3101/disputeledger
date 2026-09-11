export type UserRole = 'partner' | 'arbiter';
export type DisputeStatus = 'OPEN' | 'RESOLVED';
export type EventType = 'DISPUTE_RAISED' | 'EVIDENCE_ADDED' | 'DISPUTE_RESOLVED';

export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 400
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class ValidationError extends DomainError {
  constructor(message: string) {
    super('VALIDATION_FAILED', message, 400);
  }
}

export class InvalidCredentialsError extends DomainError {
  constructor(message: string = 'Invalid username or password.') {
    super('INVALID_CREDENTIALS', message, 401);
  }
}

export class UnauthenticatedError extends DomainError {
  constructor(message: string = 'Authentication required.') {
    super('UNAUTHENTICATED', message, 401);
  }
}

export class ForbiddenError extends DomainError {
  constructor(message: string = 'Permission denied for this action.') {
    super('FORBIDDEN', message, 403);
  }
}

export class NotFoundError extends DomainError {
  constructor(message: string = 'Dispute not found.') {
    super('NOT_FOUND', message, 404);
  }
}

export class DisputeNotOpenError extends DomainError {
  constructor(message: string) {
    super('DISPUTE_NOT_OPEN', message, 409);
  }
}

export function canUserRaiseDispute(role: UserRole): boolean {
  return role === 'partner';
}

export function assertUserCanRaiseDispute(role: UserRole): void {
  if (!canUserRaiseDispute(role)) {
    throw new ForbiddenError('Only partners may raise a dispute.');
  }
}

export function canUserViewDispute(
  user: { id: string; role: UserRole },
  dispute: { claimantId: string; respondentId: string }
): boolean {
  if (user.role === 'arbiter') {
    return true;
  }
  return dispute.claimantId === user.id || dispute.respondentId === user.id;
}

export function canUserAddEvidence(
  user: { id: string; role: UserRole },
  dispute: { claimantId: string; respondentId: string }
): boolean {
  if (user.role !== 'partner') {
    return false;
  }
  return dispute.claimantId === user.id || dispute.respondentId === user.id;
}

export function canUserResolveDispute(user: { id: string; role: UserRole }): boolean {
  return user.role === 'arbiter';
}

export function canAddEvidence(status: DisputeStatus): boolean {
  return status === 'OPEN';
}

export function assertCanAddEvidence(status: DisputeStatus): void {
  if (!canAddEvidence(status)) {
    throw new DisputeNotOpenError('Evidence cannot be added to a resolved dispute.');
  }
}

export function canResolveDispute(status: DisputeStatus): boolean {
  return status === 'OPEN';
}

export function assertCanResolve(status: DisputeStatus): void {
  if (!canResolveDispute(status)) {
    throw new DisputeNotOpenError('Dispute is already resolved.');
  }
}
