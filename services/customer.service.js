const supabase = require("../config/supabase");
const AppError = require("../errors/app-error");

async function upsertCustomer(user) {
  const { data: customer, error } = await supabase
    .from("customers")
    .upsert(
      {
        first_name: user.firstName,
        last_name: user.lastName,
        email: user.email,
        phone: user.phone,
      },
      { onConflict: "email" }
    )
    .select()
    .single();

  if (error) {
    throw new AppError("Failed to create or update customer", {
      status: 500,
      code: "CUSTOMER_UPSERT_FAILED",
      meta: error,
    });
  }

  return customer;
}

async function getCustomerById(customerId) {
  const { data: customer, error } = await supabase
    .from("customers")
    .select()
    .eq("id", customerId)
    .single();

  if (error) {
    throw new AppError("Failed to fetch customer", {
      status: 500,
      code: "CUSTOMER_FETCH_FAILED",
      meta: error,
    });
  }

  if (!customer) {
    throw new AppError("Customer not found", {
      status: 404,
      code: "CUSTOMER_NOT_FOUND",
      meta: { customerId },
    });
  }

  return customer;
}

async function getCustomerByEmail(email) {
  const { data: customer, error } = await supabase
    .from("customers")
    .select("id, first_name, last_name, email")
    .eq("email", email)
    .maybeSingle();

  if (error) {
    throw new AppError("Failed to fetch customer by email", {
      status: 500,
      code: "CUSTOMER_EMAIL_FETCH_FAILED",
      meta: error,
    });
  }

  return customer;
}

module.exports = {
  upsertCustomer,
  getCustomerById,
  getCustomerByEmail,
};
