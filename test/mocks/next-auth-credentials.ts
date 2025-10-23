const Credentials = (config?: Record<string, unknown>) => ({
  id: "credentials",
  type: "credentials",
  authorize: async () => null,
  ...config,
});

export default Credentials;
