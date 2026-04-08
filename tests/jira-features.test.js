import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  descriptionFormatFromEnv,
  isRestApiV2Prefix,
  listProjectsPathAndQuery,
} from "../src/jira-rest.js";
import { issueDescriptionPayload } from "../src/issue-description.js";
import {
  filterBoardsByName,
  getBoardValues,
  uniqueProjectKeysFromBoards,
} from "../src/jira-boards.js";
import { buildLoginToolResultText } from "../src/sso-login-messages.js";

describe("jira-rest", () => {
  it("isRestApiV2Prefix true for /rest/api/2", () => {
    assert.equal(isRestApiV2Prefix("/rest/api/2"), true);
  });
  it("isRestApiV2Prefix false for /rest/api/3", () => {
    assert.equal(isRestApiV2Prefix("/rest/api/3"), false);
  });
  it("descriptionFormatFromEnv auto: v2 -> plain", () => {
    assert.equal(descriptionFormatFromEnv("auto", "/rest/api/2"), "plain");
  });
  it("descriptionFormatFromEnv auto: v3 -> adf", () => {
    assert.equal(descriptionFormatFromEnv("auto", "/rest/api/3"), "adf");
  });
  it("descriptionFormatFromEnv explicit adf/plain", () => {
    assert.equal(descriptionFormatFromEnv("adf", "/rest/api/2"), "adf");
    assert.equal(descriptionFormatFromEnv("wiki", "/rest/api/3"), "plain");
  });
  it("descriptionFormatFromEnv invalid returns null", () => {
    assert.equal(descriptionFormatFromEnv("bogus", "/rest/api/3"), null);
  });
  it("listProjectsPathAndQuery v2 uses /project not /project/search", () => {
    const r = listProjectsPathAndQuery("/rest/api/2", 50);
    assert.equal(r.mode, "v2-array");
    assert.equal(r.pathAndQuery, "/rest/api/2/project");
    assert.ok(!r.pathAndQuery.includes("search"));
  });
  it("listProjectsPathAndQuery v3 uses project/search", () => {
    const r = listProjectsPathAndQuery("/rest/api/3", 10);
    assert.equal(r.mode, "v3-search");
    assert.match(r.pathAndQuery, /project\/search\?maxResults=10/);
  });
});

describe("issue-description", () => {
  it("plain returns string", () => {
    assert.equal(issueDescriptionPayload("hello", "plain"), "hello");
  });
  it("adf returns doc object", () => {
    const v = issueDescriptionPayload("line1\nline2", "adf");
    assert.equal(v.type, "doc");
    assert.equal(v.version, 1);
    assert.ok(Array.isArray(v.content));
  });
});

describe("sso-login-messages", () => {
  it("buildLoginToolResultText includes PAT and cookie path", () => {
    const t = buildLoginToolResultText({
      patEnvKey: "JIRA_PAT",
      cookieFile: "C:/app/cookies/session-jira.json",
      cookieCount: 1,
      sessionProbeOk: false,
    });
    assert.ok(t.includes("JIRA_PAT"));
    assert.ok(t.includes("PREFER_SSO_COOKIES=0"));
    assert.ok(t.includes("session-jira.json"));
  });
});

describe("jira-boards", () => {
  it("getBoardValues reads values array", () => {
    assert.deepEqual(getBoardValues({ values: [{ id: 1 }] }), [{ id: 1 }]);
    assert.deepEqual(getBoardValues({ data: [{ id: 2 }] }), [{ id: 2 }]);
    assert.deepEqual(getBoardValues({}), []);
  });
  it("uniqueProjectKeysFromBoards dedupes", () => {
    const keys = uniqueProjectKeysFromBoards([
      { location: { projectKey: "A" } },
      { location: { projectKey: "B" } },
      { location: { projectKey: "A" } },
    ]);
    assert.deepEqual(keys.sort(), ["A", "B"]);
  });
  it("filterBoardsByName matches exact and substring", () => {
    const boards = [
      { name: "Team Alpha Board", location: { projectKey: "ALP" } },
      { name: "Other", location: { projectKey: "OTH" } },
    ];
    assert.equal(filterBoardsByName(boards, "team alpha").length, 1);
    assert.equal(filterBoardsByName(boards, "Other").length, 1);
    assert.equal(filterBoardsByName(boards, "missing").length, 0);
  });
});
