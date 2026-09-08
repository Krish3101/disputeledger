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
      expect(stub.putState).toHaveBeenCalledWith(disputeId, expect.any(Buffer));
    });

    it('should throw if caller is not a partner', async () => {
      clientIdentity.getAttributeValue.mockImplementation(() => 'arbiter');
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
  });

  describe('AdjudicateDispute', () => {
    it('should successfully adjudicate if caller is arbiter', async () => {
      clientIdentity.getAttributeValue.mockImplementation((attr) => {
        if (attr === 'role') return 'arbiter';
        if (attr === 'hf.EnrollmentID') return 'auditor1';
        return null;
      });

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
      expect(stub.putState).toHaveBeenCalled();
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
  });

  describe('GetAllDisputes', () => {
    it('should return paginated dispute records', async () => {
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
      expect(parsedResult.bookmark).toEqual(''); // Since fetched 1 != pageSize 10
    });
  });
});
