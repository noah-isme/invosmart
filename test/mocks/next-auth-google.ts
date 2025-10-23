const Google = (config?: Record<string, unknown>) => ({
  id: "google",
  type: "oauth",
  ...config,
});

export default Google;
