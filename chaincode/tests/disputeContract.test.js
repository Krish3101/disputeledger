import { jest } from '@jest/globals';
import { DisputeContract } from '../contract.js';

describe('DisputeContract', () => {
  let contract;
  let ctx;
  let stub;
  let clientIdentity;

  beforeEach(() => {
    contract = new DisputeContract();

    // Mock the Fabric stub
    stub = {
      putState: jest.fn().mockResolvedValue(true),
      getState: jest.fn().mockResolvedValue(null),
      getStateByRangeWithPagination: jest.fn().mockResolvedValue({
        iterator: { next: jest.fn().mockResolvedValue({ done: true }) },
        metadata: { fetchedRecordsCount: 0, bookmark: '' },
      }),
      getTxTimestamp: jest.fn().mockReturnValue({ seconds: { low: 1620000000 } }),
    };

    // Mock the client identity
    clientIdentity = {
      getID: jest.fn().mockReturnValue('user-id'),
      getAttributeValue: jest.fn().mockImplementation((attr) => {
        if (attr === 'role') return 'partner';
        if (attr === 'hf.EnrollmentID') return 'supplier1';
        return null;
      }),
    };

    ctx = { stub, clientIdentity };
  });

  describe('RaiseDispute', () => {
    it('should successfully raise a new dispute', async () => {
      const disputeId = 'D-123';
      const orderRef = 'PO-999';
      const description = 'Damaged goods';

      const result = await contract.RaiseDispute(ctx, disputeId, orderRef, description);
      const parsedResult = JSON.parse(result);

      expect(parsedResult.id).toEqual(disputeId);
      expect(parsedResult.status).toEqual('PENDING');
      expect(parsedResult.raisedBy).toEqual('supplier1');
      expect(parsedResult.orderReference).toEqual(orderRef);
      expect(parsedResult.description).toEqual(description);
      expect(parsedResult.evidence).toEqual([]);
      expect(stub.putState).toHaveBeenCalledWith(disputeId, expect.any(Buffer));
    });

    it('should throw if caller is not a partner', async () => {
      clientIdentity.getAttributeValue.mockImplementation((attr) => {
        if (attr === 'role') return 'arbiter';
        return null;
      });
      await expect(contract.RaiseDispute(ctx, 'D-123', 'PO-999', 'Desc')).rejects.toThrow(
        'ACCESS_DENIED: only identities with the "partner" role can perform this action.'
      );
    });

    it('should throw if caller has no role attribute', async () => {
      clientIdentity.getAttributeValue.mockReturnValue(null);
      await expect(contract.RaiseDispute(ctx, 'D-123', 'PO-999', 'Desc')).rejects.toThrow(
        'ACCESS_DENIED: only identities with the "partner" role can perform this action.'
      );
    });

    it('should throw if dispute already exists', async () => {
      stub.getState.mockResolvedValue(Buffer.from('existing-data'));
      await expect(contract.RaiseDispute(ctx, 'D-123', 'PO-999', 'Desc')).rejects.toThrow(
        'CONFLICT: The dispute D-123 already exists'
      );
    });

    it('should validate disputeId (empty, too long, invalid characters)', async () => {
      await expect(contract.RaiseDispute(ctx, '', 'PO-999', 'Desc')).rejects.toThrow(
        'VALIDATION: Dispute ID is required and cannot be empty'
      );
      await expect(contract.RaiseDispute(ctx, 'a'.repeat(101), 'PO-999', 'Desc')).rejects.toThrow(
        'VALIDATION: Dispute ID must be less than 100 characters'
      );
      await expect(contract.RaiseDispute(ctx, 'D 123!', 'PO-999', 'Desc')).rejects.toThrow(
        'VALIDATION: Dispute ID can only contain alphanumeric characters, dashes, and underscores'
      );
    });

    it('should validate orderReference (empty, too long, invalid characters)', async () => {
      await expect(contract.RaiseDispute(ctx, 'D-123', '', 'Desc')).rejects.toThrow(
        'VALIDATION: Order Reference is required and cannot be empty'
      );
      await expect(contract.RaiseDispute(ctx, 'D-123', 'a'.repeat(101), 'Desc')).rejects.toThrow(
        'VALIDATION: Order Reference must be less than 100 characters'
      );
      await expect(contract.RaiseDispute(ctx, 'D-123', 'PO 999@', 'Desc')).rejects.toThrow(
        'VALIDATION: Order Reference can only contain alphanumeric characters, dashes, and underscores'
      );
    });

    it('should validate description (empty, too long)', async () => {
      await expect(contract.RaiseDispute(ctx, 'D-123', 'PO-999', '')).rejects.toThrow(
        'VALIDATION: Description is required and cannot be empty'
      );
      await expect(contract.RaiseDispute(ctx, 'D-123', 'PO-999', 'a'.repeat(1001))).rejects.toThrow(
        'VALIDATION: Description must be less than 1000 characters'
      );
    });
  });

  describe('AddEvidence', () => {
    it('should successfully add evidence if caller is a partner', async () => {
      const existingDispute = {
        id: 'D-123',
        status: 'PENDING',
        evidence: [],
      };
      stub.getState.mockResolvedValue(Buffer.from(JSON.stringify(existingDispute)));

      const result = await contract.AddEvidence(ctx, 'D-123', 'Photos of damaged box');
      const parsedResult = JSON.parse(result);

      expect(parsedResult.evidence.length).toBe(1);
      expect(parsedResult.evidence[0].notes).toEqual('Photos of damaged box');
      expect(parsedResult.evidence[0].submittedBy).toEqual('supplier1');
      expect(parsedResult.evidence[0].timestamp).toBeDefined();
      expect(stub.putState).toHaveBeenCalled();
    });

    it('should throw if caller is not a partner', async () => {
      clientIdentity.getAttributeValue.mockImplementation((attr) => {
        if (attr === 'role') return 'arbiter';
        return null;
      });
      await expect(contract.AddEvidence(ctx, 'D-123', 'More photos')).rejects.toThrow(
        'ACCESS_DENIED: only identities with the "partner" role can perform this action.'
      );
    });

    it('should throw if dispute does not exist', async () => {
      stub.getState.mockResolvedValue(null);
      await expect(contract.AddEvidence(ctx, 'D-999', 'Photos')).rejects.toThrow(
        'NOT_FOUND: The dispute D-999 does not exist'
      );
    });

    it('should throw if dispute is already resolved', async () => {
      const existingDispute = {
        id: 'D-123',
        status: 'RESOLVED',
        evidence: [],
      };
      stub.getState.mockResolvedValue(Buffer.from(JSON.stringify(existingDispute)));

      await expect(contract.AddEvidence(ctx, 'D-123', 'More photos')).rejects.toThrow(
        'CONFLICT: Cannot add evidence to a resolved dispute.'
      );
    });

    it('should validate evidenceNotes (empty, too long)', async () => {
      await expect(contract.AddEvidence(ctx, 'D-123', '')).rejects.toThrow(
        'VALIDATION: Evidence Notes is required and cannot be empty'
      );
      await expect(contract.AddEvidence(ctx, 'D-123', 'a'.repeat(1001))).rejects.toThrow(
        'VALIDATION: Evidence Notes must be less than 1000 characters'
      );
    });
  });

  describe('AdjudicateDispute', () => {
    beforeEach(() => {
      clientIdentity.getAttributeValue.mockImplementation((attr) => {
        if (attr === 'role') return 'arbiter';
        if (attr === 'hf.EnrollmentID') return 'auditor1';
        return null;
      });
    });

    it('should successfully adjudicate if caller is arbiter', async () => {
      const existingDispute = {
        id: 'D-123',
        status: 'PENDING',
        evidence: [],
      };
      stub.getState.mockResolvedValue(Buffer.from(JSON.stringify(existingDispute)));

      const result = await contract.AdjudicateDispute(ctx, 'D-123', 'Supplier owes refund');
      const parsedResult = JSON.parse(result);

      expect(parsedResult.status).toEqual('RESOLVED');
      expect(parsedResult.resolutionNote).toEqual('Supplier owes refund');
      expect(parsedResult.resolvedBy).toEqual('auditor1');
      expect(parsedResult.resolvedAt).toBeDefined();
      expect(stub.putState).toHaveBeenCalled();
    });

    it('should throw Access Denied if caller is not an arbiter', async () => {
      clientIdentity.getAttributeValue.mockImplementation((attr) => {
        if (attr === 'role') return 'partner';
        return null;
      });
      await expect(contract.AdjudicateDispute(ctx, 'D-123', 'Resolution')).rejects.toThrow(
        'ACCESS_DENIED: only identities with the "arbiter" role can adjudicate disputes.'
      );
    });

    it('should throw if dispute does not exist', async () => {
      stub.getState.mockResolvedValue(null);
      await expect(contract.AdjudicateDispute(ctx, 'D-999', 'Resolution')).rejects.toThrow(
        'NOT_FOUND: The dispute D-999 does not exist'
      );
    });

    it('should throw if dispute is already resolved', async () => {
      const existingDispute = {
        id: 'D-123',
        status: 'RESOLVED',
        evidence: [],
      };
      stub.getState.mockResolvedValue(Buffer.from(JSON.stringify(existingDispute)));

      await expect(contract.AdjudicateDispute(ctx, 'D-123', 'Second decision')).rejects.toThrow(
        'CONFLICT: Dispute is already resolved.'
      );
    });

    it('should validate resolutionNote (empty, too long)', async () => {
      await expect(contract.AdjudicateDispute(ctx, 'D-123', '')).rejects.toThrow(
        'VALIDATION: Resolution Note is required and cannot be empty'
      );
      await expect(contract.AdjudicateDispute(ctx, 'D-123', 'a'.repeat(1001))).rejects.toThrow(
        'VALIDATION: Resolution Note must be less than 1000 characters'
      );
    });
  });

  describe('GetDispute', () => {
    it('should return the dispute if it exists', async () => {
      const existingDispute = {
        id: 'D-123',
        orderReference: 'PO-999',
        status: 'PENDING',
        evidence: [],
      };
      stub.getState.mockResolvedValue(Buffer.from(JSON.stringify(existingDispute)));

      const result = await contract.GetDispute(ctx, 'D-123');
      const parsedResult = JSON.parse(result);

      expect(parsedResult.id).toEqual('D-123');
      expect(parsedResult.orderReference).toEqual('PO-999');
    });

    it('should throw NOT_FOUND if dispute does not exist', async () => {
      stub.getState.mockResolvedValue(null);
      await expect(contract.GetDispute(ctx, 'D-999')).rejects.toThrow(
        'NOT_FOUND: The dispute D-999 does not exist'
      );
    });

    it('should validate disputeId format', async () => {
      await expect(contract.GetDispute(ctx, 'invalid id!')).rejects.toThrow(
        'VALIDATION: Dispute ID can only contain alphanumeric characters, dashes, and underscores'
      );
    });
  });

  describe('GetAllDisputes', () => {
    it('should return paginated dispute records with empty bookmark if count < pageSize', async () => {
      stub.getStateByRangeWithPagination.mockResolvedValue({
        iterator: {
          next: jest
            .fn()
            .mockResolvedValueOnce({
              done: false,
              value: { value: Buffer.from(JSON.stringify({ id: 'D-123' })) },
            })
            .mockResolvedValueOnce({ done: true }),
        },
        metadata: { fetchedRecordsCount: 1, bookmark: 'bm1' },
      });

      const result = await contract.GetAllDisputes(ctx, '10', '');
      const parsedResult = JSON.parse(result);

      expect(parsedResult.records.length).toBe(1);
      expect(parsedResult.records[0].id).toEqual('D-123');
      expect(parsedResult.bookmark).toEqual('');
    });

    it('should return bookmark if count equals pageSize', async () => {
      stub.getStateByRangeWithPagination.mockResolvedValue({
        iterator: {
          next: jest
            .fn()
            .mockResolvedValueOnce({
              done: false,
              value: { value: Buffer.from(JSON.stringify({ id: 'D-1' })) },
            })
            .mockResolvedValueOnce({
              done: false,
              value: { value: Buffer.from(JSON.stringify({ id: 'D-2' })) },
            })
            .mockResolvedValueOnce({ done: true }),
        },
        metadata: { fetchedRecordsCount: 2, bookmark: 'bm-next' },
      });

      const result = await contract.GetAllDisputes(ctx, '2', '');
      const parsedResult = JSON.parse(result);

      expect(parsedResult.records.length).toBe(2);
      expect(parsedResult.bookmark).toEqual('bm-next');
    });
  });

  describe('DisputeExists', () => {
    it('should return true when dispute state exists', async () => {
      stub.getState.mockResolvedValue(Buffer.from('data'));
      const exists = await contract.DisputeExists(ctx, 'D-123');
      expect(exists).toBe(true);
    });

    it('should return false when dispute state is empty or null', async () => {
      stub.getState.mockResolvedValue(null);
      const exists = await contract.DisputeExists(ctx, 'D-123');
      expect(exists).toBe(false);
    });
  });
});
