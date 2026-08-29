import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("SponsorRouterMsgValueGuard", (m) => {
  const policyRegistry = m.getParameter("policyRegistry");
  const sponsorRouter = m.contract("SponsorRouter", [policyRegistry]);

  return { sponsorRouter };
});
