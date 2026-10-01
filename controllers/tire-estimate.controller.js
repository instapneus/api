const tireEstimateService = require("../services/tire-estimate.service");

async function createTireEstimate(req, res, next) {
  try {
    const data = await tireEstimateService.createTireEstimate(req.body);

    return res.status(201).json({
      success: true,
      data,
    });
  } catch (error) {
    next(error);
  }
}

async function getTireEstimate(req, res, next) {
  try {
    const { tirePurchaseRequestId } = req.params;

    const data = await tireEstimateService.getTireEstimate(
      tirePurchaseRequestId
    );

    return res.json({
      success: true,
      data,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  createTireEstimate,
  getTireEstimate,
};
