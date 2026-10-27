//! Stand-ins for the parts of Latch's Rust policy SDK the merit-x policies use: `RequestContext` (method, path,
//! headers) and `PolicyResult::{allow, deny}`, which the editor's template documents; and, for the outcall policy
//! only, `http_get(url, headers)` and `latch_eval_depth_header(&ctx)`, as Latch's spec names them.

use std::cell::RefCell;

pub struct RequestContext {
    pub method: String,
    pub path: String,
    pub headers: Vec<(String, String)>,
    pub eval_depth: u32,
}

#[derive(Debug, PartialEq)]
pub struct PolicyResult {
    pub allow: bool,
    pub reason: Option<String>,
}

impl PolicyResult {
    pub fn allow() -> Self {
        Self { allow: true, reason: None }
    }
    pub fn deny(reason: impl Into<String>) -> Self {
        Self { allow: false, reason: Some(reason.into()) }
    }
}

pub struct HttpResponse {
    pub status: u16,
    pub body: Vec<u8>,
}

type Responder = Box<dyn Fn(&str, &[(String, String)]) -> Result<HttpResponse, String>>;

thread_local! {
    static RESPONDER: RefCell<Option<Responder>> = RefCell::new(None);
    pub static CALLS: RefCell<Vec<(String, Vec<(String, String)>)>> = RefCell::new(Vec::new());
}

pub fn respond_with(f: impl Fn(&str, &[(String, String)]) -> Result<HttpResponse, String> + 'static) {
    RESPONDER.with(|r| *r.borrow_mut() = Some(Box::new(f)));
    CALLS.with(|c| c.borrow_mut().clear());
}

pub fn http_get(url: &str, headers: &[(String, String)]) -> Result<HttpResponse, String> {
    CALLS.with(|c| c.borrow_mut().push((url.to_string(), headers.to_vec())));
    RESPONDER.with(|r| (r.borrow().as_ref().expect("no responder"))(url, headers))
}

pub fn latch_eval_depth_header(ctx: &RequestContext) -> (String, String) {
    ("x-latch-eval-depth".to_string(), (ctx.eval_depth + 1).to_string())
}

include!(concat!(env!("OUT_DIR"), "/policy.rs"));

#[cfg(test)]
mod live_tests {
    use super::live::on_request;
    use super::*;

    fn req(method: &str, path: &str) -> PolicyResult {
        on_request(&RequestContext { method: method.into(), path: path.into(), headers: vec![], eval_depth: 0 })
    }

    #[test]
    fn numeric_post_lookups_pass_with_or_without_a_query() {
        assert!(req("GET", "/2/tweets/2113550979329368489").allow);
        // REX validators: /2/tweets/<id>?tweet.fields=author_id,created_at
        assert!(req("GET", "/2/tweets/2113550979329368489?tweet.fields=author_id,created_at").allow);
        assert!(req("get", "/2/tweets/1").allow);
    }

    #[test]
    fn everything_else_is_denied() {
        let no = PolicyResult::deny("merit-x allows GET /2/tweets/<numeric id> only");
        for path in ["/2/tweets/search", "/2/tweets/search/recent?query=x", "/2/tweets/1/liking_users", "/2/tweets?ids=1,2", "/2/tweets", "/2/tweets/", "/2/users/42", "/2/tweets/123456789012345678901"] {
            assert_eq!(req("GET", path), no, "{path}");
        }
        assert_eq!(req("POST", "/2/tweets"), PolicyResult::deny("merit-x is read-only"));
        assert_eq!(req("DELETE", "/2/tweets/1"), PolicyResult::deny("merit-x is read-only"));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    use super::outcall::on_request;

    fn get(path: &str) -> PolicyResult {
        on_request(&RequestContext { method: "GET".into(), path: path.into(), headers: vec![], eval_depth: 0 })
    }
    /// Merit's check endpoint, through merit-check: OK only for ids in `known`.
    fn merit(known: &'static [&'static str]) {
        respond_with(move |url, _| {
            let ids = url.rsplit('/').next().unwrap().to_string();
            if ids.split(',').all(|id| known.contains(&id)) {
                Ok(HttpResponse { status: 200, body: format!("MERIT-OK {ids}").into_bytes() })
            } else {
                Ok(HttpResponse { status: 404, body: b"MERIT-NO".to_vec() })
            }
        });
    }
    fn calls() -> Vec<(String, Vec<(String, String)>)> {
        CALLS.with(|c| c.borrow().clone())
    }

    #[test]
    fn a_submission_is_read_and_the_check_is_governed() {
        merit(&["2113550979329368489"]);
        assert!(get("/2/tweets/2113550979329368489").allow);
        // REX validators and the judge send fields in the query; the id is in the path.
        assert!(get("/2/tweets/2113550979329368489?tweet.fields=author_id,created_at").allow);
        let (url, headers) = calls().pop().unwrap();
        assert_eq!(url, "https://onlatch.com/proxy/api/latch/tweet-check/2113550979329368489");
        assert!(headers.iter().any(|(k, v)| k == "Authorization" && v.starts_with("Bearer lat_")));
        assert!(headers.iter().any(|(k, _)| k == "x-latch-eval-depth"));
    }

    #[test]
    fn a_random_post_is_denied() {
        merit(&["1"]);
        let r = get("/2/tweets/1999999999999999999");
        assert!(!r.allow);
        assert!(r.reason.unwrap().contains("not a Merit submission (check answered 404)"));
    }

    #[test]
    fn ids_lookup_needs_every_id_known() {
        merit(&["1", "2"]);
        assert!(get("/2/tweets?ids=1,2&tweet.fields=author_id").allow);
        assert!(get("/2/tweets?ids=1%2C2").allow);
        assert!(!get("/2/tweets?ids=1,3").allow);
        assert!(!get("/2/tweets").allow, "ids hidden from the policy: deny");
        assert!(!get("/2/tweets?ids=1,abc").allow);
        assert!(!get("/2/tweets?ids=1,2,3,4,5,6,7,8,9,10,11").allow);
    }

    #[test]
    fn fails_closed() {
        respond_with(|_, _| Err("timeout".into()));
        assert_eq!(get("/2/tweets/1").reason.as_deref(), Some("Merit's submission check is unreachable (fail closed)"));
        // A 200 that isn't Merit's exact answer (a login page, a proxy error page) is a no.
        respond_with(|_, _| Ok(HttpResponse { status: 200, body: b"<html>ok</html>".to_vec() }));
        assert!(!get("/2/tweets/1").allow);
        respond_with(|_, _| Ok(HttpResponse { status: 200, body: b"MERIT-OK 2".to_vec() }));
        assert!(!get("/2/tweets/1").allow, "an answer about another id is a no");
    }

    #[test]
    fn writes_and_other_tweet_paths_are_refused_users_pass_through() {
        merit(&["1"]);
        let post = on_request(&RequestContext { method: "POST".into(), path: "/2/tweets".into(), headers: vec![], eval_depth: 0 });
        assert_eq!(post, PolicyResult::deny("merit-x is read-only"));
        assert!(!get("/2/tweets/search/recent?query=x").allow);
        assert!(!get("/2/tweets/1/liking_users").allow);
        assert!(get("/2/users/42").allow);
        assert!(calls().is_empty(), "no check for paths the policy decides itself");
    }
}
