const supabase = require("../config/supabase");
const AppError = require("../errors/app-error");

async function createMechanicInterest(
  customerId,
  companyId,
  locationId,
  vehicleServices
) {
  const wantsMechanic = vehicleServices.some(
    (vehicleService) => vehicleService.mobileMechanic?.isMechanicServiceWanted
  );

  if (!wantsMechanic) {
    return null;
  }

  const { data, error } = await supabase
    .from("service_interests")
    .upsert(
      {
        customer_id: customerId,
        company_id: companyId,
        location_id: locationId,
        service_type: "mechanic",
        source: "company_reservation",
      },
      {
        onConflict: "customer_id,service_type",
        ignoreDuplicates: true,
      }
    )
    .select()
    .maybeSingle();

  if (error) {
    throw new AppError("Failed to create mechanic interest", {
      status: 500,
      code: "CREATE_MECHANIC_INTEREST_FAILED",
      meta: error,
    });
  }

  return data;
}

module.exports = {
  createMechanicInterest,
};
