import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import getAllFiles from "../utils/getAllFiles.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default (client) => {
  const eventFolders = getAllFiles(path.join(__dirname, "..", "events"), true);

  let eventCount = 0;

  eventFolders.forEach((eventFolder) => {
    const eventFiles = getAllFiles(eventFolder);
    const eventName = path.basename(eventFolder); 

    eventCount += eventFiles.length;

    client.on(eventName, async (...args) => {
      for (const eventFile of eventFiles) {
        const { default: eventFunction } = await import(pathToFileURL(eventFile).href);
        await eventFunction(client, ...args);
      }
    });
  });

  client.eventCount = eventCount; 
};
