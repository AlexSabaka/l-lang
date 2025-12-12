export function getCaller(offset: number = 1): string {
  return (
    Error()
      .stack?.split("\n")
      [offset].replace(/\s*at\s/gi, "")
      .replace(/\s+\(.*?\)/gi, "") ?? ""
  );
}
