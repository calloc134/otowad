import type { WorkerAnalysisArtifactEntry } from "./projectWorkerProtocol.ts";

interface ProjectWorkerRecoveryClient {
  replaceAnalysisArtifacts(
    entries: WorkerAnalysisArtifactEntry[],
    projectRevision: number,
    mode: "replace_all" | "upsert",
  ): Promise<void>;
}

interface ProjectWorkerRecoverySnapshot {
  analysisEntries: WorkerAnalysisArtifactEntry[];
}

interface ActiveWorkerCacheSync {
  workerGeneration: number;
  promise: Promise<void>;
}

export class ProjectWorkerRecovery {
  private readonly client: ProjectWorkerRecoveryClient;
  private readonly snapshotProvider: () => ProjectWorkerRecoverySnapshot;
  private workerGenerationAwaitingSync: number | null = null;
  private activeSync: ActiveWorkerCacheSync | null = null;

  constructor(
    client: ProjectWorkerRecoveryClient,
    snapshotProvider: () => ProjectWorkerRecoverySnapshot,
  ) {
    this.client = client;
    this.snapshotProvider = snapshotProvider;
  }

  markWorkerReset(workerGeneration: number): void {
    this.workerGenerationAwaitingSync = workerGeneration;
  }

  async ensureWorkerCaches(projectRevision: number): Promise<void> {
    const workerGeneration = this.workerGenerationAwaitingSync;
    if (workerGeneration === null) {
      return;
    }
    if (this.activeSync?.workerGeneration === workerGeneration) {
      await this.activeSync.promise;
      return;
    }

    const snapshot = this.snapshotProvider();
    const promise = (async () => {
      await this.client.replaceAnalysisArtifacts(
        snapshot.analysisEntries,
        projectRevision,
        "replace_all",
      );
      if (this.workerGenerationAwaitingSync === workerGeneration) {
        this.workerGenerationAwaitingSync = null;
      }
    })();
    const activeSync = { workerGeneration, promise };
    this.activeSync = activeSync;

    try {
      await promise;
    } finally {
      if (this.activeSync === activeSync) {
        this.activeSync = null;
      }
    }
  }
}
