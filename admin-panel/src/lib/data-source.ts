// Controls whether the admin panel reads from the database or serves
// hard-coded dummy data. Set `SHOW_DUMMY_DATA=true` in the environment to
// review the UI without a populated database. Remove this before go-live.
export const showDummyData: boolean = process.env.SHOW_DUMMY_DATA === "true";
