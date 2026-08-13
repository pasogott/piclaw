import { describe, expect, test } from "bun:test";

import { SERVICE_OUTBOX_STORE_CONTRACT_CASE_NAMES } from "../../src/service-effects/testing/contract-suites/service-outbox-store-contract.js";
import { EFFECTOR_CASE_CATALOGUE } from "../../src/service-effects/testing/effector-case-catalogue.js";

describe("EF-S05 catalogue alignment", () => {
	test("maps every required case, one crash oracle and only supplementary extras", () => {
		const ids = SERVICE_OUTBOX_STORE_CONTRACT_CASE_NAMES.map(
			(name) => name.split(" ", 1)[0],
		);
		const catalogue = EFFECTOR_CASE_CATALOGUE.find(
			(entry) => entry.contractId === "EF-S05",
		);
		expect(catalogue).toBeDefined();
		expect(ids.filter((id) => /^EF-S05-C\d+$/.test(id))).toEqual(
			catalogue?.requiredCases.map((entry) => entry.caseId),
		);
		expect(ids.filter((id) => id === "EF-S05-R01")).toEqual(["EF-S05-R01"]);
		expect(
			ids.every((id) => /^EF-S05-(?:C[1-8]|R01|S\d{2})$/.test(id)),
		).toBeTrue();
	});
});
