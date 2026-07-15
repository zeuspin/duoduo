import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";
import "./asr.css";
import "./live-insights.css";
import "./forms.css";
import "./parser.css";
createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
