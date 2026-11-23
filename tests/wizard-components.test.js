import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import WizardProgress from "../app/components/WizardProgress.jsx";
import WizardNavigation from "../app/components/WizardNavigation.jsx";

test("component: step 2 is locked while the app gate is off", () => {
  const html = renderToStaticMarkup(
    React.createElement(WizardProgress, { currentStep: 1, maxStep: 1, onStepClick() {} }),
  );
  assert.match(html, /aria-disabled="true"/);
});

test("component: step 2 is enabled once maxStep allows it", () => {
  const html = renderToStaticMarkup(
    React.createElement(WizardProgress, { currentStep: 1, maxStep: 2, onStepClick() {} }),
  );
  assert.doesNotMatch(html, /aria-disabled="true"/);
});

test("component: progress renders both step labels", () => {
  const html = renderToStaticMarkup(
    React.createElement(WizardProgress, { currentStep: 2, maxStep: 2, onStepClick() {} }),
  );
  assert.match(html, /Start/);
  assert.match(html, /Scripts/);
});

test("component: Continue hidden until the app and audit are complete", () => {
  const html = renderToStaticMarkup(
    React.createElement(WizardNavigation, { currentStep: 1, maxStep: 1, onChange() {} }),
  );
  assert.doesNotMatch(html, /Continue/);
});

test("component: Continue shown when maxStep is 2", () => {
  const html = renderToStaticMarkup(
    React.createElement(WizardNavigation, { currentStep: 1, maxStep: 2, onChange() {} }),
  );
  assert.match(html, /Continue/);
});

test("component: Back hidden on first step, Continue hidden on last", () => {
  const first = renderToStaticMarkup(
    React.createElement(WizardNavigation, { currentStep: 1, maxStep: 2, onChange() {} }),
  );
  assert.doesNotMatch(first, /Back/);
  const last = renderToStaticMarkup(
    React.createElement(WizardNavigation, { currentStep: 2, maxStep: 2, onChange() {} }),
  );
  assert.doesNotMatch(last, /Continue/);
  assert.match(last, /Back/);
});
