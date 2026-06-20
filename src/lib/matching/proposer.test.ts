import { describe, it, expect } from "vitest";
import { normalizeProposal } from "./proposer";

const candidates = [{ id: "prog:a" }, { id: "prog:b" }, { id: "prog:c" }];

describe("normalizeProposal", () => {
  it("候補に無い programId は捨てる", () => {
    const out = normalizeProposal(
      {
        summary: "総括",
        items: [
          { programId: "prog:a", score: 0.9 },
          { programId: "prog:zzz", score: 0.8 }, // 候補外
        ],
      },
      candidates,
      10,
    );
    expect(out.items.map((i) => i.programId)).toEqual(["prog:a"]);
    expect(out.summary).toBe("総括");
  });

  it("score 降順に並べ、max で切る", () => {
    const out = normalizeProposal(
      {
        items: [
          { programId: "prog:a", score: 0.3 },
          { programId: "prog:b", score: 0.9 },
          { programId: "prog:c", score: 0.6 },
        ],
      },
      candidates,
      2,
    );
    expect(out.items.map((i) => i.programId)).toEqual(["prog:b", "prog:c"]);
  });

  it("重複 programId は1つに、score/confidence は 0..1 にクランプ", () => {
    const out = normalizeProposal(
      {
        items: [
          { programId: "prog:a", score: 5, confidence: -1 },
          { programId: "prog:a", score: 0.5 },
        ],
      },
      candidates,
      10,
    );
    expect(out.items.length).toBe(1);
    expect(out.items[0]!.score).toBe(1);
    expect(out.items[0]!.confidence).toBe(0);
  });

  it("配列でない prepare/sources は空配列に正規化", () => {
    const out = normalizeProposal(
      { items: [{ programId: "prog:b", prepare: "x", sources: null }] },
      candidates,
      10,
    );
    expect(out.items[0]!.prepare).toEqual([]);
    expect(out.items[0]!.sources).toEqual([]);
  });

  it("空入力でも落ちない", () => {
    const out = normalizeProposal({}, candidates, 10);
    expect(out).toEqual({ summary: "", items: [] });
  });
});
