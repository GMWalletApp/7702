import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("Sponsored7702AccountModule", (m) => {
  const initialOwner = m.getParameter("initialOwner");
  const initialFeeReceiver = m.getParameter("initialFeeReceiver");

  const policyRegistry = m.contract("SponsorPolicyRegistry", [initialOwner, initialFeeReceiver]);
  const accountImplementation = m.contract("Sponsored7702Account", [policyRegistry]);
  const sponsorRouter = m.contract("SponsorRouter", [policyRegistry]);

  m.call(policyRegistry, "setRouter", [sponsorRouter]);

  return { accountImplementation, policyRegistry, sponsorRouter };
});
