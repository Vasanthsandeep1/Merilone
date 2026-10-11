import type { NativeStackScreenProps } from '@react-navigation/native-stack';

export type RootStack = {
  Main: undefined;
  JobDetail: { id: number };
  EditProfile: { edit: true } | undefined;
};
export type Tabs = { Requests: undefined; MyJobs: undefined; Profile: undefined };

export type StackProps<K extends keyof RootStack> = NativeStackScreenProps<RootStack, K>;
