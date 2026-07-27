export type LargestRemainderItem = {
  id: string;
  floor: number;
  remainder: number;
};

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function allocateLargestRemainders(
  items: ReadonlyArray<LargestRemainderItem>,
  targetTotal: number,
): Map<string, number> {
  if (!Number.isSafeInteger(targetTotal) || targetTotal < 0) {
    throw new Error("Largest-remainder target must be a non-negative integer");
  }

  const ids = new Set<string>();
  let floorTotal = 0;
  items.forEach((item) => {
    if (ids.has(item.id)) {
      throw new Error(`Largest-remainder IDs must be unique: ${item.id}`);
    }
    ids.add(item.id);

    if (!Number.isSafeInteger(item.floor) || item.floor < 0) {
      throw new Error("Largest-remainder floors must be non-negative integers");
    }
    if (
      !Number.isFinite(item.remainder) ||
      item.remainder < 0 ||
      item.remainder >= 1
    ) {
      throw new Error(
        "Largest-remainder fractions must be finite values from zero up to one",
      );
    }
    floorTotal += item.floor;
  });

  const increments = targetTotal - floorTotal;
  if (increments < 0 || increments > items.length) {
    throw new Error("Largest-remainder target is impossible");
  }

  const incrementedIds = new Set(
    [...items]
      .sort(
        (left, right) =>
          right.remainder - left.remainder || compareIds(left.id, right.id),
      )
      .slice(0, increments)
      .map((item) => item.id),
  );

  return new Map(
    [...items]
      .sort((left, right) => compareIds(left.id, right.id))
      .map((item) => [
        item.id,
        item.floor + (incrementedIds.has(item.id) ? 1 : 0),
      ]),
  );
}
