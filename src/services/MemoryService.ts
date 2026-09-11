import { MemoryRepository, MemoryRow } from "../db/repositories/MemoryRepository";

export interface ShortTermMemoryEntry {
  matchId: string;
  companionId: string;
  note: string;
  category: string;
  createdAt: string;
}

export class MemoryService {
  private shortTerm = new Map<string, ShortTermMemoryEntry[]>();

  constructor(private repo: MemoryRepository) {}

  addShortTerm(entry: ShortTermMemoryEntry): void {
    const list = this.shortTerm.get(entry.matchId) ?? [];
    list.push(entry);
    this.shortTerm.set(entry.matchId, list);
  }

  async consolidateMatch(matchId: string, companionId: string, playerId: string): Promise<void> {
    // Claim the entries synchronously (get + delete with no await between
    // them) so a concurrent call for the same matchId — even one dispatched
    // "at the same time" via Promise.all — always sees an already-empty
    // list rather than racing to read the same entries before either
    // clears them. JS async functions run synchronously up to their first
    // await, so this ordering is guaranteed single-threaded, not best-effort.
    const shortEntries = this.shortTerm.get(matchId) ?? [];
    this.shortTerm.delete(matchId);

    for (const entry of shortEntries) {
      await this.repo.recordObservation(companionId, playerId, entry.category, entry.note);
    }
  }

  async retrieve(
    companionId: string,
    playerId: string,
    matchId: string,
    limit = 5
  ): Promise<{ shortTerm: ShortTermMemoryEntry[]; longTerm: MemoryRow[] }> {
    const shortTerm = (this.shortTerm.get(matchId) ?? []).slice(-limit);
    const longTerm = await this.repo.retrieve(companionId, playerId, limit);
    return { shortTerm, longTerm };
  }
}
