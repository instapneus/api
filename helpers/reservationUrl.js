const ServiceType = require("../constants/serviceTypes");
const ReservationType = require("../constants/reservationTypes");

function getConfirmationUrl({
  reservationId,
  token,
  reservationType,
  serviceType,
}) {
  let flow = "";

  if (reservationType === ReservationType.Company) {
    flow = serviceType === ServiceType.Tire ? "company" : "mechanic";
  }

  if (reservationType === ReservationType.Residential) {
    flow =
      serviceType === ServiceType.Tire ? "residential" : "residential-mechanic";
  }

  return `${process.env.FRONTEND_URL}/${flow}/confirmation/${reservationId}?token=${token}`;
}

module.exports = {
  getConfirmationUrl,
};
