import { EnvironmentId } from "@t3tools/contracts";

const STORYBOOK_ENVIRONMENT_ID = EnvironmentId.make("storybook-environment");

export const usePrimaryEnvironmentId = () => STORYBOOK_ENVIRONMENT_ID;
