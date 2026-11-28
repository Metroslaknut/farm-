/* eslint-disable @typescript-eslint/no-explicit-any -- generic record engine: shape is driven by the per-kind config/schema */
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Alert } from '../../../components/ui';
import { api } from '../../../api';
import { useAsync } from '../../../lib/useAsync';
import { useFarmsT } from '../labels';
import { useFarm } from '../useFarmAccess';
import { RecordForm } from './RecordForm';
import type { Draft, KindConfig } from './recordConfigs';

/** `/farms/:farmId/<kind>/new` and `/farms/:farmId/<kind>/:id/edit` */
export default function RecordFormPage({ config }: { config: KindConfig }) {
  const t = useFarmsT();
  const { farmId = '', id } = useParams();
  const [search] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { farm, can } = useFarm(farmId);
  const existing = useAsync(
    async (signal) =>
      id
        ? (
            await api.request<{ record: any }>('GET', `/farms/${farmId}/${config.path}/${id}`, {
              signal,
            })
          ).record
        : null,
    [farmId, id, config.path],
  );

  const back = id ? `/farms/${farmId}/${config.path}/${id}` : `/farms/${farmId}/${config.path}`;
  const allowed = id ? can(config.permissions.correct) : can(config.permissions.write);
  if (farm && (farm.status === 'archived' || !allowed)) {
    return (
      <Alert tone="warning">
        {farm.status === 'archived'
          ? t('common.farmArchived')
          : t(id ? 'rec.form.noPermissionCorrect' : 'rec.form.noPermissionAdd', {
              records: t(config.plural).toLowerCase(),
            })}
      </Alert>
    );
  }
  if (id && existing.loading && !existing.data) return <p role="status">{t('common.loading')}</p>;
  if (existing.error) return <Alert tone="danger">{existing.error}</Alert>;
  if (existing.data?.voided) return <Alert tone="warning">{t('rec.form.voided')}</Alert>;

  const prefill: Draft = {};
  for (const key of ['animalId', 'damId']) if (search.get(key)) prefill[key] = search.get(key)!;
  // Values the assistant understood (PR 6a): only this form's own fields, as text, for the person to check and save.
  const fromAssistant = (location.state as { assistantPrefill?: Record<string, unknown> } | null)
    ?.assistantPrefill;
  if (!id && fromAssistant)
    for (const f of config.fields)
      if (typeof fromAssistant[f.name] === 'string')
        prefill[f.name] = fromAssistant[f.name] as string;

  return (
    <>
      <p>
        <Link to={back}>{t('common.back')}</Link>
      </p>
      <h1>
        {t(id ? 'rec.form.correctTitle' : 'rec.form.newTitle', { singular: t(config.singular) })}
      </h1>
      <RecordForm
        config={config}
        farmId={farmId}
        record={existing.data ?? undefined}
        prefill={prefill}
        onCancel={() => navigate(back)}
        onDone={(r) => navigate(`/farms/${farmId}/${config.path}/${r.id}`)}
      />
    </>
  );
}
