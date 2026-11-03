// ============================================================================
//  one סושי בר – הגדרות מערכת ההזמנות
//  Everything the restaurant may want to change lives here. No build step:
//  edit, save, reload.
// ============================================================================
window.ONE_CONFIG = {
  restaurant: {
    name: "one סושי בר",
    phone: "08-6489237",
    address: "הציונות 13, אשדוד",
    addressNote: "המסעדה ברחוב שד' מנחם בגין",
    siteUrl: "https://onesushibar.co.il/",
    // Logo and hero image are taken from the existing site. Replace with local
    // files (e.g. "assets/logo.png") if the app is hosted elsewhere.
    logoUrl: "https://onesushibar.co.il/wp-content/uploads/2019/03/לוגו-one.jpg",
    heroImage: "https://onesushibar.co.il/wp-content/uploads/2019/03/תמונה-באנר-עליון-min.jpg",
  },

  ordering: {
    // ---- Where orders go. Fill at least one. All three can be combined. ----
    // WhatsApp number of the restaurant in international format, digits only
    // (e.g. "972501234567"). The order opens in WhatsApp as a pre-filled message.
    whatsappNumber: "",
    // Optional HTTPS endpoint that receives the order as JSON via POST
    // (a small backend, Google Apps Script, Make/Zapier webhook, etc.).
    orderEndpoint: "",
    // Optional e-mail address: opens the customer's mail app with the order.
    orderEmail: "",

    // ---- Service ----
    deliveryEnabled: true,
    pickupEnabled: true,
    currency: "₪",
    minimumOrder: 80,          // minimum subtotal for an order (₪). 0 = none
    deliveryFee: 20,           // ₪
    freeDeliveryFrom: 250,     // subtotal from which delivery is free (₪). 0 = never
    deliveryCities: ["אשדוד"], // cities/areas the restaurant delivers to
    prepTimeMinutes: { delivery: 60, pickup: 30 },
    paymentMethods: [
      { id: "cash", label: "מזומן בעת המסירה" },
      { id: "card", label: "כרטיס אשראי בעת המסירה" },
      { id: "bit",  label: "ביט (bit) לפני המסירה" },
    ],
    // Let customers place orders (for a scheduled time) while the restaurant is closed?
    acceptOrdersWhenClosed: false,

    // ---- Opening hours (0 = Sunday … 6 = Saturday). Several ranges per day
    //      are allowed; a range may cross midnight ("19:00"-"01:00").
    //      TODO: confirm with the restaurant – these are placeholders.
    hours: {
      0: [["12:00", "23:00"]],
      1: [["12:00", "23:00"]],
      2: [["12:00", "23:00"]],
      3: [["12:00", "23:00"]],
      4: [["12:00", "23:00"]],
      5: [["12:00", "16:00"]],
      6: [["19:00", "23:30"]],
    },
  },
};
