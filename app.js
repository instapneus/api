require("./instrument");

const express = require("express");
const app = express();

const {
  syncReservationToGoogleSheet,
} = require("./services/google-sheet/reservation-sheet-sync.service");

// Middleware
const errorHandler = require("./middleware/error-handler.middleware");

// Routes
const companyRoutes = require("./routes/company.routes");
const reservationRoutes = require("./routes/reservation.routes");
const serviceRoutes = require("./routes/service.routes");
const waitlistRoutes = require("./routes/waitlist.routes");
const twilioWebhookRoutes = require("./routes/twilio-webhook.routes");
const reservationNotificationRoutes = require("./routes/reservation-notification.routes");
const tireEstimateRoutes = require("./routes/tire-estimate.routes");
const companyAvailabilityAdminRoutes = require("./routes/company-availability-admin.routes");

app.use(express.json());

app.use((req, res, next) => {
  const allowedOrigins = [
    "http://localhost:4200",
    "https://forms.instapneus.com",
    "http://forms.instapneus.com",
  ];

  const origin = req.headers.origin;

  if (allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }

  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, PATCH, DELETE, OPTIONS"
  );

  res.setHeader(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept, Authorization"
  );

  res.setHeader("Access-Control-Allow-Credentials", "true");

  // IMPORTANT: handle preflight immediately
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }

  next();
});

// API Routes
app.use("/api/companies", companyRoutes);
app.use("/api/reservations", reservationRoutes);
app.use("/api/services", serviceRoutes);
app.use("/api/waitlist", waitlistRoutes);
app.use("/api/tire-estimates", tireEstimateRoutes);
app.use("/api/notifications", reservationNotificationRoutes);
app.use("/api/webhooks/twilio", twilioWebhookRoutes);
app.use("/api/company-availability-admin", companyAvailabilityAdminRoutes);

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "API is running",
  });
});

if (process.env.NODE_ENV !== "production") {
  app.get("/api/debug/sentry", (req, res) => {
    throw new Error("Sentry API integration test");
  });
}

app.get("/api/debug/google-sheet/:reservationId", async (req, res, next) => {
  try {
    const result = await syncReservationToGoogleSheet(req.params.reservationId);

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
});

app.use((req, res, next) => {
  res.status(404).json({
    success: false,
    message: "Route not found",
    code: "NOT_FOUND",
  });
});

// Global error handler
app.use(errorHandler);

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
});
