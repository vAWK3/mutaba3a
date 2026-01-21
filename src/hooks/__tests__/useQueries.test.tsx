import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { db } from '../../db/database';
import { businessProfileRepo, documentRepo, clientRepo } from '../../db/repository';
import { getOrCreateLocalDevice } from '../../sync/core/ops-engine';
import { initializeClock } from '../../sync/core/hlc';
import {
  useDocuments,
  useDocument,
  useCreateDocument,
  useUpdateDocument,
  useMarkDocumentPaid,
  useVoidDocument,
  useDeleteDocument,
  useBusinessProfiles,
  useBusinessProfile,
  useDefaultBusinessProfile,
  useCreateBusinessProfile,
  useUpdateBusinessProfile,
  useSetDefaultBusinessProfile,
  useArchiveBusinessProfile,
} from '../useQueries';
import type { BusinessProfile, Document } from '../../types';

// Create a test query client
function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

// Create wrapper with query client
function createWrapper() {
  const queryClient = createTestQueryClient();
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    );
  };
}

describe('Business Profile Hooks', () => {
  beforeAll(async () => {
    // Initialize local device and clock for sync operations
    const device = await getOrCreateLocalDevice();
    initializeClock(device.id);
  });

  beforeEach(async () => {
    await db.businessProfiles.clear();
  });

  afterEach(async () => {
    await db.businessProfiles.clear();
  });

  const createTestProfile = (): Omit<BusinessProfile, 'id' | 'createdAt' | 'updatedAt'> => ({
    name: 'Test Company',
    nameEn: 'Test Company EN',
    email: 'test@example.com',
    phone: '+972501234567',
    taxId: '123456789',
    businessType: 'company',
    address1: 'Test Address',
    city: 'Test City',
    country: 'Test Country',
    postalCode: '12345',
    defaultCurrency: 'USD',
    defaultLanguage: 'en',
    isDefault: false,
  });

  describe('useBusinessProfiles', () => {
    it('should return empty array when no profiles exist', async () => {
      const { result } = renderHook(() => useBusinessProfiles(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toEqual([]);
    });

    it('should return profiles when they exist', async () => {
      await businessProfileRepo.create(createTestProfile());
      await businessProfileRepo.create({ ...createTestProfile(), name: 'Second Company' });

      const { result } = renderHook(() => useBusinessProfiles(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toHaveLength(2);
    });
  });

  describe('useBusinessProfile', () => {
    it('should return a specific profile by id', async () => {
      const created = await businessProfileRepo.create(createTestProfile());

      const { result } = renderHook(() => useBusinessProfile(created.id), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data?.id).toBe(created.id);
      expect(result.current.data?.name).toBe('Test Company');
    });

    it('should not fetch when id is empty', async () => {
      const { result } = renderHook(() => useBusinessProfile(''), {
        wrapper: createWrapper(),
      });

      // Should not be loading or fetching
      expect(result.current.isFetching).toBe(false);
    });
  });

  describe('useDefaultBusinessProfile', () => {
    it('should return undefined when no default exists', async () => {
      await businessProfileRepo.create(createTestProfile());

      const { result } = renderHook(() => useDefaultBusinessProfile(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isFetching).toBe(false));
      expect(result.current.data).toBeUndefined();
    });

    it('should return the default profile', async () => {
      await businessProfileRepo.create({ ...createTestProfile(), isDefault: true });

      const { result } = renderHook(() => useDefaultBusinessProfile(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data?.isDefault).toBe(true);
    });
  });

  describe('useCreateBusinessProfile', () => {
    it('should create a new profile', async () => {
      const { result } = renderHook(() => useCreateBusinessProfile(), {
        wrapper: createWrapper(),
      });

      await result.current.mutateAsync(createTestProfile());

      const profiles = await businessProfileRepo.list();
      expect(profiles).toHaveLength(1);
      expect(profiles[0].name).toBe('Test Company');
    });
  });

  describe('useUpdateBusinessProfile', () => {
    it('should update an existing profile', async () => {
      const created = await businessProfileRepo.create(createTestProfile());

      const { result } = renderHook(() => useUpdateBusinessProfile(), {
        wrapper: createWrapper(),
      });

      await result.current.mutateAsync({
        id: created.id,
        data: { name: 'Updated Name' },
      });

      const updated = await businessProfileRepo.get(created.id);
      expect(updated?.name).toBe('Updated Name');
    });
  });

  describe('useSetDefaultBusinessProfile', () => {
    it('should set a profile as default', async () => {
      const profile = await businessProfileRepo.create(createTestProfile());

      const { result } = renderHook(() => useSetDefaultBusinessProfile(), {
        wrapper: createWrapper(),
      });

      await result.current.mutateAsync(profile.id);

      const updated = await businessProfileRepo.get(profile.id);
      expect(updated?.isDefault).toBe(true);
    });
  });

  describe('useArchiveBusinessProfile', () => {
    it('should archive a profile', async () => {
      const profile = await businessProfileRepo.create(createTestProfile());

      const { result } = renderHook(() => useArchiveBusinessProfile(), {
        wrapper: createWrapper(),
      });

      await result.current.mutateAsync(profile.id);

      const archived = await businessProfileRepo.get(profile.id);
      expect(archived?.archivedAt).toBeDefined();
    });
  });
});

describe('Document Hooks', () => {
  let testProfile: BusinessProfile;
  let testClient: { id: string; name: string };

  beforeEach(async () => {
    await db.documents.clear();
    await db.documentSequences.clear();
    await db.businessProfiles.clear();
    await db.clients.clear();

    testProfile = await businessProfileRepo.create({
      name: 'Test Company',
      email: 'test@example.com',
      businessType: 'company',
      defaultCurrency: 'USD',
      defaultLanguage: 'en',
      isDefault: true,
    });

    testClient = await clientRepo.create({
      name: 'Test Client',
      email: 'client@example.com',
    });
  });

  afterEach(async () => {
    await db.documents.clear();
    await db.documentSequences.clear();
    await db.businessProfiles.clear();
    await db.clients.clear();
  });

  const createTestDocument = (): Omit<Document, 'id' | 'number' | 'createdAt' | 'updatedAt'> => ({
    type: 'invoice',
    status: 'draft',
    businessProfileId: testProfile.id,
    clientId: testClient.id,
    subject: 'Test Invoice',
    items: [
      {
        name: 'Test Item',
        quantity: 1,
        rateMinor: 10000,
        rateVatMinor: 11700,
        discountMinor: 0,
        taxExempt: false,
      },
    ],
    payments: [],
    subtotalMinor: 10000,
    discountMinor: 0,
    taxMinor: 1700,
    totalMinor: 11700,
    taxRate: 0.17,
    vatEnabled: true,
    currency: 'USD',
    language: 'en',
    issueDate: new Date().toISOString().split('T')[0],
    linkedTransactionIds: [],
    templateId: 'template1',
    exportCount: 0,
  });

  describe('useDocuments', () => {
    it('should return empty array when no documents exist', async () => {
      const { result } = renderHook(() => useDocuments({}), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toEqual([]);
    });

    it('should return documents with filters', async () => {
      await documentRepo.create(createTestDocument());
      await documentRepo.create({ ...createTestDocument(), type: 'receipt' });

      const { result } = renderHook(() => useDocuments({ type: 'invoice' }), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toHaveLength(1);
      expect(result.current.data?.[0].type).toBe('invoice');
    });
  });

  describe('useDocument', () => {
    it('should return a specific document by id', async () => {
      const created = await documentRepo.create(createTestDocument());

      const { result } = renderHook(() => useDocument(created.id), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data?.id).toBe(created.id);
      expect(result.current.data?.number).toBe('INV-0001');
    });

    it('should not fetch when id is empty', async () => {
      const { result } = renderHook(() => useDocument(''), {
        wrapper: createWrapper(),
      });

      expect(result.current.isFetching).toBe(false);
    });
  });

  describe('useCreateDocument', () => {
    it('should create a new document with auto-generated number', async () => {
      const { result } = renderHook(() => useCreateDocument(), {
        wrapper: createWrapper(),
      });

      const doc = await result.current.mutateAsync(createTestDocument());

      expect(doc.id).toBeDefined();
      expect(doc.number).toBe('INV-0001');
    });
  });

  describe('useUpdateDocument', () => {
    it('should update an existing document', async () => {
      const created = await documentRepo.create(createTestDocument());

      const { result } = renderHook(() => useUpdateDocument(), {
        wrapper: createWrapper(),
      });

      await result.current.mutateAsync({
        id: created.id,
        data: { subject: 'Updated Subject' },
      });

      const updated = await documentRepo.get(created.id);
      expect(updated?.subject).toBe('Updated Subject');
    });
  });

  describe('useMarkDocumentPaid', () => {
    it('should mark a document as paid', async () => {
      const created = await documentRepo.create({ ...createTestDocument(), status: 'issued' });

      const { result } = renderHook(() => useMarkDocumentPaid(), {
        wrapper: createWrapper(),
      });

      await result.current.mutateAsync(created.id);

      const updated = await documentRepo.get(created.id);
      expect(updated?.status).toBe('paid');
      expect(updated?.paidAt).toBeDefined();
    });
  });

  describe('useVoidDocument', () => {
    it('should void a document', async () => {
      const created = await documentRepo.create({ ...createTestDocument(), status: 'issued' });

      const { result } = renderHook(() => useVoidDocument(), {
        wrapper: createWrapper(),
      });

      await result.current.mutateAsync(created.id);

      const updated = await documentRepo.get(created.id);
      expect(updated?.status).toBe('voided');
    });
  });

  describe('useDeleteDocument', () => {
    it('should soft delete a document', async () => {
      const created = await documentRepo.create(createTestDocument());

      const { result } = renderHook(() => useDeleteDocument(), {
        wrapper: createWrapper(),
      });

      await result.current.mutateAsync(created.id);

      const deleted = await documentRepo.get(created.id);
      expect(deleted?.deletedAt).toBeDefined();
    });
  });
});
