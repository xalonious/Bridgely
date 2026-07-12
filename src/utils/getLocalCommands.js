import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import getAllFiles from "./getAllFiles.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default async (exceptions = []) => {
    let localCommands = [];

    const commandCategories = getAllFiles(path.join(__dirname, "..", "commands"), true);

    for(const commandCategory of commandCategories) {
        const commandFiles = getAllFiles(commandCategory);

        for(const commandFile of commandFiles) {
            const { default: commandObject } = await import(pathToFileURL(commandFile).href);

            if(exceptions.includes(commandObject.name)) {
                continue;
            }
            localCommands.push(commandObject);
        }
    }

    return localCommands;
};
