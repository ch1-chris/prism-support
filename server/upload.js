import multer from 'multer';
import { tmpdir } from 'os';
import { join } from 'path';

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

export const videoUpload = multer({
  storage: multer.diskStorage({
    destination: join(tmpdir(), 'prism-uploads'),
    filename: (_req, file, cb) => {
      cb(null, `${Date.now()}-${file.originalname}`);
    },
  }),
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('video/')) {
      cb(null, true);
    } else {
      cb(new Error('Only video files are accepted'));
    }
  },
});
