import { Router, type Request, type RequestHandler } from 'express';
import {
  commentListQuerySchema,
  createCommentSchema,
  createPostSchema,
  feedQuerySchema,
  reactionSchema,
  reportSchema,
  updateCommentSchema,
  updatePostSchema,
} from '@farmplus/validation';
import type { AppContext } from '../../context';
import { parse, requireActor } from '../../lib/http';
import { parseObjectId } from '../../lib/object-id';
import { authenticate } from '../../middleware/authenticate';
import { rateLimits } from '../../middleware/rate-limit';
import { createComment, deleteComment, listComments, updateComment } from './comments.service';
import { follow, profileOf, unfollow } from './follows.service';
import { reportContent } from './moderation.service';
import { createPost, deletePost, getPost, listFeed, updatePost } from './posts.service';
import { react, unreact } from './reactions.service';

const id = (req: Request, name = 'id') => parseObjectId(req.params[name]);

function policy(ctx: AppContext) {
  return {
    allowedHosts: ctx.env.MEDIA_ALLOWED_HOSTS,
    production: ctx.env.NODE_ENV === 'production',
  };
}

/** `/api/v1/posts` and `/api/v1/comments`. Every route needs a signed-in, active user. */
export function postsRouter(ctx: AppContext): Router {
  const router = Router();
  const limits = rateLimits(ctx.env);
  router.use(authenticate(ctx));

  router.get('/', async (req, res) => {
    res.json(await listFeed(requireActor(req), parse(feedQuerySchema, req.query)));
  });
  router.post('/', limits.post, async (req, res) => {
    res.status(201).json({
      post: await createPost(requireActor(req), parse(createPostSchema, req.body), policy(ctx)),
    });
  });
  router.get('/:id', async (req, res) => {
    res.json({ post: await getPost(requireActor(req), id(req)) });
  });
  router.patch('/:id', limits.post, async (req, res) => {
    res.json({
      post: await updatePost(
        requireActor(req),
        id(req),
        parse(updatePostSchema, req.body),
        policy(ctx),
      ),
    });
  });
  router.delete('/:id', async (req, res) => {
    await deletePost(requireActor(req), id(req));
    res.status(204).end();
  });

  router.post('/:id/reactions', limits.react, async (req, res) => {
    const { type } = parse(reactionSchema, req.body ?? {});
    res.json(await react(requireActor(req), 'post', id(req), type));
  });
  router.delete('/:id/reactions', limits.react, async (req, res) => {
    res.json(await unreact(requireActor(req), 'post', id(req)));
  });

  router.get('/:id/comments', async (req, res) => {
    res.json(
      await listComments(requireActor(req), id(req), parse(commentListQuerySchema, req.query)),
    );
  });
  router.post('/:id/comments', limits.comment, async (req, res) => {
    res.status(201).json({
      comment: await createComment(
        requireActor(req),
        id(req),
        parse(createCommentSchema, req.body),
      ),
    });
  });
  router.post('/:id/reports', limits.report, async (req, res) => {
    res
      .status(201)
      .json(await reportContent(requireActor(req), 'post', id(req), parse(reportSchema, req.body)));
  });
  return router;
}

export function commentsRouter(ctx: AppContext): Router {
  const router = Router();
  const limits = rateLimits(ctx.env);
  router.use(authenticate(ctx));
  router.patch('/:id', limits.comment, async (req, res) => {
    const { body } = parse(updateCommentSchema, req.body);
    res.json({ comment: await updateComment(requireActor(req), id(req), body) });
  });
  router.delete('/:id', async (req, res) => {
    await deleteComment(requireActor(req), id(req));
    res.status(204).end();
  });
  router.post('/:id/reactions', limits.react, async (req, res) => {
    const { type } = parse(reactionSchema, req.body ?? {});
    res.json(await react(requireActor(req), 'comment', id(req), type));
  });
  router.delete('/:id/reactions', limits.react, async (req, res) => {
    res.json(await unreact(requireActor(req), 'comment', id(req)));
  });
  router.post('/:id/reports', limits.report, async (req, res) => {
    res
      .status(201)
      .json(
        await reportContent(requireActor(req), 'comment', id(req), parse(reportSchema, req.body)),
      );
  });
  return router;
}

/** Mounted inside the users router (which already authenticates). */
export function mountUserCommunityRoutes(router: Router, ctx: AppContext): void {
  const limits = rateLimits(ctx.env);
  const handler =
    (fn: (req: Request) => Promise<unknown>): RequestHandler =>
    async (req, res) => {
      res.json(await fn(req));
    };
  router.get(
    '/:id/profile',
    handler((req) => profileOf(requireActor(req), id(req))),
  );
  router.post(
    '/:id/follow',
    limits.follow,
    handler((req) => follow(requireActor(req), id(req))),
  );
  router.delete(
    '/:id/follow',
    limits.follow,
    handler((req) => unfollow(requireActor(req), id(req))),
  );
}
