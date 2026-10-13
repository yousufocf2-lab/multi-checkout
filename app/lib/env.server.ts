function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name}`);
  return v;
}

export const env = {
  get appUrl() {
    return required("APP_URL").replace(/\/+$/, "");
  },
  get adminPassword() {
    return required("ADMIN_PASSWORD");
  },
  get sessionSecret() {
    return required("SESSION_SECRET");
  },
};
