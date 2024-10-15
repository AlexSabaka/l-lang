export const deepeq = (a: any, b: any): boolean => {
  const da = JSON.parse(JSON.stringify(a));
  const db = JSON.parse(JSON.stringify(b));
  const dak = Object.keys(da);
  const dbk = Object.keys(db);
  if (dak.length !== dbk.length) {
    return false;
  }

  return dak.every((k) => {
    if (da[k] === undefined || db[k] === undefined) {
      return false;
    } else if (typeof da[k] === "object" && typeof db[k] === "object") {
      return deepeq(da[k], db[k]);
    } else if (Array.isArray(da[k]) && Array.isArray(da[k])) {
      return da[k].every((daki, i) => deepeq(daki, db[k][i]));
    } else {
      return da[k] === db[k];
    }
  });
};
