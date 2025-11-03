import { ExperimentAxis, ExperimentStatus } from "@prisma/client";

import { listExperiments, serializeExperimentSummary } from "@/lib/ai/content-local-optimizer";

import { ExperimentTable } from "./components/ExperimentTable";
import { StartExperimentForm } from "./components/StartExperimentForm";

type ExperimentsPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

const resolveSearchParams = async (
  searchParams: ExperimentsPageProps["searchParams"],
) => (await searchParams) ?? {};

const parseAxis = (value?: string | string[]) => {
  if (!value) return undefined;
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate in ExperimentAxis ? (candidate as ExperimentAxis) : undefined;
};

const parseStatus = (value?: string | string[]) => {
  if (!value) return undefined;
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate in ExperimentStatus ? (candidate as ExperimentStatus) : undefined;
};

export default async function ExperimentsPage({ searchParams }: ExperimentsPageProps) {
  const resolvedSearchParams = await resolveSearchParams(searchParams);

  const axis = parseAxis(resolvedSearchParams.axis);
  const status = parseStatus(resolvedSearchParams.status);
  const organizationId =
    typeof resolvedSearchParams.organizationId === "string" ? resolvedSearchParams.organizationId : undefined;

  const experiments = await listExperiments({
    organizationId,
    axis,
    status,
    limit: 30,
  });

  const serialized = experiments.map((experiment) => serializeExperimentSummary(experiment));

  return (
    <div className="flex flex-col gap-8">
      <StartExperimentForm />
      <ExperimentTable experiments={serialized} axisFilter={axis} statusFilter={status} />
    </div>
  );
}
