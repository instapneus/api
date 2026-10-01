const serviceService = require("../services/service.service");
const asyncHandler = require("./../utils/asyncHandelr");

const getServices = asyncHandler(async (req, res) => {
  const { categories } = req.query;
  const data = await serviceService.getServices(categories);
  res.json({ success: true, data });
});

module.exports = {
  getServices,
};
