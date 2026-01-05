import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Drawer } from './Drawer';
import { useDrawerStore } from '../../lib/stores';
import { useClient, useCreateClient, useUpdateClient, useArchiveClient } from '../../hooks/useQueries';
import { cn } from '../../lib/utils';
import { useT } from '../../lib/i18n';

const schema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Invalid email').optional().or(z.literal('')),
  phone: z.string().optional(),
  notes: z.string().optional(),
});

type FormData = z.infer<typeof schema>;

export function ClientDrawer() {
  const { clientDrawer, closeClientDrawer } = useDrawerStore();
  const { mode, clientId } = clientDrawer;
  const t = useT();

  const { data: existingClient, isLoading: clientLoading } = useClient(clientId || '');
  const createMutation = useCreateClient();
  const updateMutation = useUpdateClient();
  const archiveMutation = useArchiveClient();

  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: '',
      email: '',
      phone: '',
      notes: '',
    },
  });

  // Reset form when existing client loads
  useEffect(() => {
    if (existingClient) {
      form.reset({
        name: existingClient.name,
        email: existingClient.email || '',
        phone: existingClient.phone || '',
        notes: existingClient.notes || '',
      });
    }
  }, [existingClient, form]);

  const onSubmit = async (data: FormData) => {
    const clientData = {
      name: data.name,
      email: data.email || undefined,
      phone: data.phone || undefined,
      notes: data.notes || undefined,
    };

    try {
      if (mode === 'edit' && clientId) {
        await updateMutation.mutateAsync({ id: clientId, data: clientData });
      } else {
        await createMutation.mutateAsync(clientData);
      }
      closeClientDrawer();
    } catch (error) {
      console.error('Failed to save client:', error);
    }
  };

  const handleArchive = async () => {
    if (!clientId) return;
    if (!confirm(t('clients.confirmArchive'))) return;

    try {
      await archiveMutation.mutateAsync(clientId);
      closeClientDrawer();
    } catch (error) {
      console.error('Failed to archive client:', error);
    }
  };

  const isSubmitting = createMutation.isPending || updateMutation.isPending;

  if (mode === 'edit' && clientLoading) {
    return (
      <Drawer title={t('common.loading')} onClose={closeClientDrawer}>
        <div className="loading">
          <div className="spinner" />
        </div>
      </Drawer>
    );
  }

  return (
    <Drawer
      title={mode === 'edit' ? t('drawer.client.edit') : t('drawer.client.new')}
      onClose={closeClientDrawer}
      footer={
        <>
          <div className="drawer-footer-left">
            {mode === 'edit' && (
              <button
                type="button"
                className="btn btn-danger"
                onClick={handleArchive}
                disabled={archiveMutation.isPending}
              >
                {t('common.archive')}
              </button>
            )}
          </div>
          <div className="drawer-footer-right">
            <button type="button" className="btn btn-secondary" onClick={closeClientDrawer}>
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              form="client-form"
              className="btn btn-primary"
              disabled={isSubmitting}
            >
              {isSubmitting ? t('common.saving') : t('common.save')}
            </button>
          </div>
        </>
      }
    >
      <form id="client-form" onSubmit={form.handleSubmit(onSubmit)}>
        <div className="form-group">
          <label className="form-label">{t('drawer.client.name')} *</label>
          <input
            type="text"
            className={cn('input', form.formState.errors.name && 'input-error')}
            placeholder={t('drawer.client.namePlaceholder')}
            {...form.register('name')}
          />
          {form.formState.errors.name && (
            <p className="form-error">{t('validation.nameRequired')}</p>
          )}
        </div>

        <div className="form-group">
          <label className="form-label">{t('drawer.client.email')}</label>
          <input
            type="email"
            className={cn('input', form.formState.errors.email && 'input-error')}
            placeholder={t('drawer.client.emailPlaceholder')}
            {...form.register('email')}
          />
          {form.formState.errors.email && (
            <p className="form-error">{form.formState.errors.email.message}</p>
          )}
        </div>

        <div className="form-group">
          <label className="form-label">{t('drawer.client.phone')}</label>
          <input
            type="tel"
            className="input"
            placeholder={t('drawer.client.phonePlaceholder')}
            {...form.register('phone')}
          />
        </div>

        <div className="form-group">
          <label className="form-label">{t('drawer.client.notes')}</label>
          <textarea
            className="textarea"
            placeholder={t('drawer.client.notesPlaceholder')}
            {...form.register('notes')}
          />
        </div>
      </form>
    </Drawer>
  );
}
