import { useEffect } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Drawer } from './Drawer';
import { useDrawerStore } from '../../lib/stores';
import {
  useProject,
  useCreateProject,
  useUpdateProject,
  useArchiveProject,
  useClients,
} from '../../hooks/useQueries';
import { cn } from '../../lib/utils';

const FIELDS = ['Design', 'Development', 'Consulting', 'Marketing', 'Legal', 'Maintenance', 'Other'];

const schema = z.object({
  name: z.string().min(1, 'Name is required'),
  clientId: z.string().optional(),
  field: z.string().optional(),
  notes: z.string().optional(),
});

type FormData = z.infer<typeof schema>;

export function ProjectDrawer() {
  const { projectDrawer, closeProjectDrawer } = useDrawerStore();
  const { mode, projectId, defaultClientId } = projectDrawer;

  const { data: existingProject, isLoading: projectLoading } = useProject(projectId || '');
  const { data: clients = [] } = useClients();
  const createMutation = useCreateProject();
  const updateMutation = useUpdateProject();
  const archiveMutation = useArchiveProject();

  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: '',
      clientId: defaultClientId || '',
      field: '',
      notes: '',
    },
  });

  // Reset form when existing project loads
  useEffect(() => {
    if (existingProject) {
      form.reset({
        name: existingProject.name,
        clientId: existingProject.clientId || '',
        field: existingProject.field || '',
        notes: existingProject.notes || '',
      });
    }
  }, [existingProject, form]);

  const onSubmit = async (data: FormData) => {
    const projectData = {
      name: data.name,
      clientId: data.clientId || undefined,
      field: data.field || undefined,
      notes: data.notes || undefined,
    };

    try {
      if (mode === 'edit' && projectId) {
        await updateMutation.mutateAsync({ id: projectId, data: projectData });
      } else {
        await createMutation.mutateAsync(projectData);
      }
      closeProjectDrawer();
    } catch (error) {
      console.error('Failed to save project:', error);
    }
  };

  const handleArchive = async () => {
    if (!projectId) return;
    if (!confirm('Are you sure you want to archive this project?')) return;

    try {
      await archiveMutation.mutateAsync(projectId);
      closeProjectDrawer();
    } catch (error) {
      console.error('Failed to archive project:', error);
    }
  };

  const isSubmitting = createMutation.isPending || updateMutation.isPending;

  if (mode === 'edit' && projectLoading) {
    return (
      <Drawer title="Loading..." onClose={closeProjectDrawer}>
        <div className="loading">
          <div className="spinner" />
        </div>
      </Drawer>
    );
  }

  return (
    <Drawer
      title={mode === 'edit' ? 'Edit Project' : 'New Project'}
      onClose={closeProjectDrawer}
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
                Archive
              </button>
            )}
          </div>
          <div className="drawer-footer-right">
            <button type="button" className="btn btn-secondary" onClick={closeProjectDrawer}>
              Cancel
            </button>
            <button
              type="submit"
              form="project-form"
              className="btn btn-primary"
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Saving...' : 'Save'}
            </button>
          </div>
        </>
      }
    >
      <form id="project-form" onSubmit={form.handleSubmit(onSubmit)}>
        <div className="form-group">
          <label className="form-label">Name *</label>
          <input
            type="text"
            className={cn('input', form.formState.errors.name && 'input-error')}
            placeholder="Project name..."
            {...form.register('name')}
          />
          {form.formState.errors.name && (
            <p className="form-error">{form.formState.errors.name.message}</p>
          )}
        </div>

        <div className="form-group">
          <label className="form-label">Client</label>
          <Controller
            name="clientId"
            control={form.control}
            render={({ field }) => (
              <select className="select" style={{ width: '100%' }} {...field}>
                <option value="">Select client...</option>
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name}
                  </option>
                ))}
              </select>
            )}
          />
        </div>

        <div className="form-group">
          <label className="form-label">Field</label>
          <Controller
            name="field"
            control={form.control}
            render={({ field }) => (
              <select className="select" style={{ width: '100%' }} {...field}>
                <option value="">Select field...</option>
                {FIELDS.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            )}
          />
        </div>

        <div className="form-group">
          <label className="form-label">Notes</label>
          <textarea
            className="textarea"
            placeholder="Additional notes about this project..."
            {...form.register('notes')}
          />
        </div>
      </form>
    </Drawer>
  );
}
