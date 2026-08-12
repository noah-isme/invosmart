declare module 'midtrans-client' {
  type SnapOptions = {
    isProduction: boolean;
    serverKey: string;
    clientKey: string;
  };

  interface Snap {
    createTransaction(payload: Record<string, unknown>): Promise<{
      token?: string;
      redirect_url?: string;
    }>;
  }

  const midtrans: { Snap: new (options: SnapOptions) => Snap };
  export default midtrans;
}
