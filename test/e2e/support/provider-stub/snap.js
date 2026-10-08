/* Fake Midtrans Snap client served by the e2e provider stub. */
(function () {
  window.snap = {
    pay: function (token, callbacks) {
      var result = {
        status_code: "200",
        status_message: "Success, transaction is found",
        transaction_status: "settlement",
        order_id: String(token),
        payment_type: "e2e_stub",
      };
      setTimeout(function () {
        if (typeof callbacks === "function") {
          callbacks(result);
        } else if (callbacks && typeof callbacks.onSuccess === "function") {
          callbacks.onSuccess(result);
        }
      }, 0);
    },
    hide: function () {},
  };
})();
