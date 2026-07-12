import fs from "fs";
import path from "path";

export default (directory, foldersOnly = false) => {
    const files = fs.readdirSync(directory, { withFileTypes: true });

    return files
        .filter(file => foldersOnly ? file.isDirectory() : file.isFile())
        .map(file => path.join(directory, file.name));
};
