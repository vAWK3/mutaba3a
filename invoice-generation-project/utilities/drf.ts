export const toSnakeCase = (obj: any): any => {
  if (obj === null || obj === undefined) return obj;

  if (Array.isArray(obj)) {
    return obj.map((item) => toSnakeCase(item));
  } else if (typeof obj === 'object') {
    return Object.keys(obj).reduce((acc, key) => {
      const snakeKey = key.replace(/([A-Z])/g, "_$1").toLowerCase();
      acc[snakeKey] = toSnakeCase(obj[key]);
      return acc;
    }, {} as any);
  } else {
    return obj;
  }
};

export const toCamelCase = (obj: any): any => {
  if (obj === null || obj === undefined) return obj;

  if (Array.isArray(obj)) {
    return obj.map((item) => toCamelCase(item));
  } else if (typeof obj === 'object') {
    return Object.keys(obj).reduce((acc, key) => {
      const newKeyName = key.replace(/(\_\w)/g, function (m) { return m[1].toUpperCase(); });
      acc[newKeyName] = toCamelCase(obj[key]);
      return acc;
    }, {} as any);
  } else {
    return obj;
  }
}