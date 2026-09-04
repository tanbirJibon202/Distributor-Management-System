export interface IQuery {
  searchTerm?: string;
  search?: string;
  page?: string;
  limit?: string;
  sortBy?: string;
  sortOrder?: string;

  //any other filter fields can be added here
  // biome-ignore lint/suspicious/noExplicitAny: query params arrive untyped from Express
  [key: string]: any;
}
