import React from "react";
import ReactDOM from "react-dom/client";
import { IntlProvider } from "react-intl";
import { AppRoot } from "@dynatrace/strato-components/core";
import { BrowserRouter } from "react-router-dom";
import { App } from "./app/App";

const root = ReactDOM.createRoot(document.getElementById("root")!);
root.render(
  <IntlProvider locale="en" defaultLocale="en">
    <AppRoot>
      <BrowserRouter basename="ui">
        <App />
      </BrowserRouter>
    </AppRoot>
  </IntlProvider>
);
