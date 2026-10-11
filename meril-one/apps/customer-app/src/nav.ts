import type { NativeStackScreenProps } from '@react-navigation/native-stack';

export type RootStack = {
  Main: undefined;
  // No categoryId = every service (used for a product in a custom category).
  // productId = booking for one of My Products; it's preselected on Book.
  Category: { categoryId?: number; name: string; productId?: number };
  // serviceId missing = choose the service on the Book screen.
  // oemEngineerId = the product's OEM engineer (service_engineers id).
  // urgent: from the SOS button — today, problem marked as an urgent breakdown.
  Book: { serviceId?: number; productId?: number; engineerId?: number; oemEngineerId?: number; categoryId?: number; urgent?: boolean };
  // Pick an engineer for a category (or service); no category = any skill.
  ChooseEngineer: { title: string; categoryId?: number; serviceId?: number; productId?: number };
  EngineerProfile: { engineerId: number; categoryId?: number; serviceId?: number; productId?: number };
  BookingDetail: { id: number };
  EditProfile: { edit: true } | undefined;
  ProductForm: { id?: number; categoryKey?: string } | undefined;
  ProductDetail: { id: number };
  ProductCategory: { key: string; name: string; custom: boolean };
  Notifications: undefined;
};
export type Tabs = { Home: undefined; Store: undefined; Bookings: undefined; Track: undefined; Products: undefined; Alerts: undefined; Account: undefined };

export type StackProps<K extends keyof RootStack> = NativeStackScreenProps<RootStack, K>;
